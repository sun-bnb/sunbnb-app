/**
 * Aerial / drone photo -> map parcels (track 030 S7). Two tools, MAP-mode sites only:
 *
 *   request_photo_alignment({ upload_id })  -- computes a seed georef (DJI XMP pose, else the site
 *     centre) and emits SSE `align_photo` (`AlignPhotoEvent` from @repo/agent/vision/aerial-schema):
 *     the client opens the overlay alignment UI and, in parallel, starts the extraction via
 *     `POST /api/assistant/aerial/[uploadId]/extract`. Changes nothing; the model must WAIT for the
 *     user to confirm the alignment (the client then sends a message).
 *   propose_layout_from_photo({ upload_id, min_confidence? }) -- needs the saved georef AND a done
 *     descriptor (else returns guidance: align first / still reading / failed); fits the descriptor
 *     (`aerial/plan.ts`) and stores one or more `inventory_batch` proposals (<= 1200 seats each) via
 *     the existing propose path, with per-parcel confidence + overlap / sea warnings on the card.
 *
 * Never Google imagery: the only pixels read are the partner's own upload (track 030 D9).
 */
import type { GeoPoint } from '@repo/agent/geo/coastline'
import type { LatLng } from '@repo/agent/geo/georef'
import { validateAerialDescriptor, type AlignPhotoEvent } from '@repo/agent/vision/aerial-schema'
import { getUploadForAccount, type AerialState } from '@repo/data/assistant'
import prisma from '@repo/data/PrismaCient'
import { prepareAerialImage, isAerialImageMime } from '../aerial/image'
import { readPhotoMeta, type PhotoMeta } from '../aerial/photo-meta'
import { planAerialLayout, DEFAULT_MIN_CONFIDENCE, type PlannedParcel } from '../aerial/plan'
import { seedGeoref } from '../aerial/seed'
import { validateGeoref } from '../aerial/georef-validate'
import { createAndApply } from '../proposals/act'
import { inventoryHandler, planInventory } from '../proposals/handlers/inventory'
import { ID } from '../request'
import { readUploadBlob } from '../uploads'
import { withSummary } from './extract-plan'
import { defineTool, type AssistantTool, type AssistantToolCtx } from './helpers'
import { APPLIED_INSTRUCTION } from './propose-core'

const NOT_MAP =
  'This site uses the schematic layout, not the map: an aerial photo cannot be placed on it. If the user has a drawn or printed PLAN, use extract_schematic_from_plan instead; otherwise they place parcels in the Schematic tab.'
const GONE = 'That attachment is no longer available: ask the user to attach the photo again'
const NOT_IMAGE = 'Only a JPEG, PNG or WebP photo can be read (HEIC is not supported): ask the user to send the photo as JPEG or PNG'
const OBLIQUE =
  'This photo was taken at an angle, not straight down, so distances in it are distorted. Ask the user for a TOP-DOWN drone photo (camera pointing straight down) of the beach. Never suggest satellite or Google imagery.'
const SHORE_RADIUS_M = 600

export interface AerialToolDeps {
  read: (url: string) => Promise<Buffer>
  meta: (original: Buffer) => Promise<PhotoMeta>
  imageSize: (original: Buffer) => Promise<{ w: number; h: number }>
  /** Shore lines around a point, or null when not configured / failed (the land check is skipped). */
  shore: (centre: LatLng) => Promise<{ ways: GeoPoint[][]; water: GeoPoint[][] } | null>
}

export const defaultAerialToolDeps: AerialToolDeps = {
  read: readUploadBlob,
  meta: readPhotoMeta,
  async imageSize(original) {
    const img = await prepareAerialImage(original)
    return { w: img.width, h: img.height }
  },
  async shore(centre) {
    if (!process.env.COASTLINE_POSTGRES_URL) return null
    try {
      const { shoreAround } = await import('@repo/data/coastline-lookup')
      return await shoreAround(centre.lat, centre.lng, SHORE_RADIUS_M)
    } catch (err) {
      console.error('[assistant] shoreline lookup failed', err)
      return null
    }
  },
}

type Fail = { ok: false; error: string }
const fail = (error: string): Fail => ({ ok: false, error })

async function loadSite(siteId: string) {
  return prisma.site.findUnique({ where: { id: siteId }, select: { layoutMode: true, locationLat: true, locationLng: true } })
}

/** Shared preamble: map-mode site + an account-scoped, same-site, live image upload. */
async function resolve(input: Record<string, unknown>, ctx: AssistantToolCtx) {
  const uploadId = input.upload_id
  if (typeof uploadId !== 'string' || !ID.test(uploadId)) return { fail: fail('upload_id is required (the id of the attached photo)') }
  const site = await loadSite(ctx.siteId)
  if (!site) return { fail: fail('forbidden') }
  if (site.layoutMode === 'schematic') return { fail: fail(NOT_MAP) }
  const row = await getUploadForAccount(uploadId, ctx.accountId)
  // Missing / foreign / purged / other-site / expired all read the same.
  if (!row || row.siteId !== ctx.siteId || row.expiresAt.getTime() <= Date.now()) return { fail: fail(GONE) }
  if (!isAerialImageMime(row.mime)) return { fail: fail(NOT_IMAGE) }
  const lat = parseFloat(site.locationLat)
  const lng = parseFloat(site.locationLng)
  return { row, centre: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null }
}

export function createRequestPhotoAlignment(deps: AerialToolDeps = defaultAerialToolDeps): AssistantTool {
  return defineTool({
    name: 'request_photo_alignment',
    label: 'Opening photo alignment',
    description:
      'Step 1 of turning an attached TOP-DOWN aerial / drone photo of the beach into sunbed parcels on the map (map-layout sites only). Opens the alignment view, where the user lays the photo over the map and confirms; the photo is read in the background meanwhile. Pass the attachment\'s uploadId from the page context as upload_id. It changes nothing. After calling it, tell the user to align the photo and press confirm, then STOP and wait: do not call propose_layout_from_photo until the user says the alignment is confirmed.',
    properties: { upload_id: { type: 'string', maxLength: 64, description: 'The attached photo\'s uploadId (page context attachments)' } },
    required: ['upload_id'],
    async run(input, ctx) {
      const r = await resolve(input, ctx)
      if ('fail' in r) return r.fail
      const { row, centre } = r
      let original: Buffer
      try {
        original = await deps.read(row.url)
      } catch {
        return fail(GONE)
      }
      const [meta, image] = await Promise.all([deps.meta(original), deps.imageSize(original)])
      if (meta.dji && !meta.dji.nadir) return fail(OBLIQUE)
      const aerial = row.aerial as AerialState | null
      const descriptor = aerial?.status === 'done' ? (aerial.descriptor as { view?: string; bed?: { lengthPx?: number } } | undefined) : undefined
      if (descriptor?.view === 'oblique') return fail(OBLIQUE)
      if (!centre && !meta.dji) return fail('The site has no map location yet: ask the user to set it on the General tab first')
      const seed = seedGeoref({ meta, image, siteCentre: centre ?? { lat: meta.dji!.lat, lng: meta.dji!.lng }, bedLengthPx: descriptor?.bed?.lengthPx ?? null })
      const event: AlignPhotoEvent = { uploadId: row.id, seed: seed.georef, image }
      ctx.emit?.('align_photo', event)
      return {
        ok: true,
        status: 'aligning',
        seedSource: seed.source,
        alreadyAligned: !!row.georef,
        instruction:
          (seed.source === 'dji'
            ? 'The photo was pre-placed from the drone\'s GPS data; '
            : 'The photo was placed at the site location at a rough scale; ') +
          'the alignment view is opening for the user. Tell them to drag / rotate / scale the photo until it matches the map (existing parcels and the shoreline help), then press confirm. Then STOP and wait for their confirmation message before calling propose_layout_from_photo. Nothing has changed.',
      }
    },
  })
}

function describeParcel(p: PlannedParcel): string {
  const shape = `${p.rows} x ${p.seatsPerRow}${p.paired ? ' paired' : ''}`
  return `Parcel ${p.number}: ${shape} (${p.seats} sunbeds), confidence ${Math.round(p.confidence * 100)}%${p.flipped ? ', beds turned to face away from the sea' : ''}${p.warnings.length ? `; ${p.warnings.join('; ')}` : ''}`
}

export function createProposeLayoutFromPhoto(deps: AerialToolDeps = defaultAerialToolDeps): AssistantTool {
  return defineTool({
    name: 'propose_layout_from_photo',
    label: 'Laying out parcels from the photo',
    description:
      'Step 2: after the user CONFIRMED the photo alignment (request_photo_alignment), create the sunbed parcels the photo shows on the map (applied immediately, one undoable card each; at most 5 cards per message). Each parcel carries a confidence; parcels below min_confidence (default 0.4) are left out. If the photo is still being read, it says so: tell the user and try again when they ask. Undo reverts a card within 24 h.',
    properties: {
      upload_id: { type: 'string', maxLength: 64, description: 'The aligned photo\'s uploadId' },
      min_confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Leave out parcels below this confidence (default 0.4)' },
    },
    required: ['upload_id'],
    async run(input, ctx) {
      const r = await resolve(input, ctx)
      if ('fail' in r) return r.fail
      const { row } = r

      const georef = validateGeoref(row.georef, null)
      if (!row.georef || !georef.ok) {
        return { ok: true, status: 'needs_alignment', instruction: 'The photo has not been aligned on the map yet. Call request_photo_alignment for it (or ask the user to finish and confirm the alignment), then wait for their confirmation.' }
      }
      const aerial = row.aerial as AerialState | null
      if (!aerial || aerial.status === 'running') {
        return { ok: true, status: 'reading', instruction: 'The photo is still being read (this can take a minute or two, and needs the alignment view to have been opened). Tell the user it is still reading and to ask again shortly. Do not call this tool again in the same turn.' }
      }
      if (aerial.status === 'failed') {
        const limit = aerial.error === 'aerial_limit' || aerial.error === 'extraction_limit' || aerial.error === 'rate_limited' || aerial.error === 'budget'
        return fail(limit
          ? 'extraction_limit: the daily limit for reading photos has been reached; try again tomorrow'
          : aerial.error === 'refusal' || aerial.error === 'unreadable'
            ? 'The photo could not be read: ask for a sharper, top-down drone photo of the beach'
            : 'The photo could not be read right now: reopen the alignment view to retry')
      }
      const checked = validateAerialDescriptor(aerial.descriptor)
      if (!checked.ok) return fail('The stored reading of this photo is invalid: reopen the alignment view to read it again')
      const descriptor = checked.descriptor
      if (descriptor.view === 'oblique') return fail(OBLIQUE)
      if (!descriptor.usable || descriptor.parcels.length === 0) {
        return fail(`No sunbed rows could be read from this photo${descriptor.ignored.length ? ` (${descriptor.ignored.join('; ')})` : ''}: ask for a clearer top-down drone photo where the sunbeds are visible`)
      }

      const minConfidence = typeof input.min_confidence === 'number' ? Math.min(1, Math.max(0, input.min_confidence)) : DEFAULT_MIN_CONFIDENCE
      const [items, agg] = await Promise.all([
        prisma.inventoryItem.findMany({ where: { siteId: ctx.siteId, status: { not: 'pool' } }, select: { group: true, locationLat: true, locationLng: true } }),
        prisma.inventoryItem.aggregate({ where: { siteId: ctx.siteId }, _max: { group: true } }),
      ])
      const byParcel = new Map<number, LatLng[]>()
      for (const it of items) {
        if (it.group === null || it.group === undefined) continue
        const lat = parseFloat(it.locationLat)
        const lng = parseFloat(it.locationLng)
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
        const list = byParcel.get(it.group) ?? []
        list.push({ lat, lng })
        byParcel.set(it.group, list)
      }
      const shore = await deps.shore(georef.georef.anchor)
      const plan = planAerialLayout({
        descriptor,
        georef: georef.georef,
        nextParcelNumber: (agg._max.group ?? 0) + 1,
        minConfidence,
        existing: [...byParcel].map(([parcel, points]) => ({ parcel, points })),
        shore,
      })
      const warnings = [...plan.warnings]
      if (!shore) warnings.push('The coastline could not be checked here, so parcels were not tested against the sea')
      if (plan.proposals.length === 0) {
        return { ok: false, error: `No parcel was confident enough to propose (min_confidence ${minConfidence})`, warnings }
      }

      const cards: Array<{ actionId: string; summary: string; parcels: number[]; status: 'applied' | 'proposed' }> = []
      const failed: string[] = []
      for (const [i, p] of plan.proposals.entries()) {
        const planned = await planInventory(ctx.siteId, p.ops)
        if ('errors' in planned) {
          failed.push(planned.errors.join('; '))
          continue
        }
        const lowest = Math.min(...p.parcels.map((x) => x.confidence))
        const part = plan.proposals.length > 1 ? ` (part ${i + 1} of ${plan.proposals.length})` : ''
        const summary = `From your photo${part}: ${p.parcels.length} parcel${p.parcels.length === 1 ? '' : 's'} (${p.seats} sunbeds), lowest confidence ${Math.round(lowest * 100)}%`
        const res = await createAndApply(ctx, withSummary(inventoryHandler, summary), planned.payload, [...(i === 0 ? warnings : []), ...p.parcels.map(describeParcel)])
        if (res.ok) cards.push({ actionId: res.card.actionId, summary: res.card.summary, parcels: p.parcels.map((x) => x.number), status: res.applied ? 'applied' : 'proposed' })
        else failed.push(res.error)
      }
      if (cards.length === 0) return { ok: false, error: failed.join('; ') || 'No proposal could be made', warnings }
      return {
        ok: true,
        status: cards.every((c) => c.status === 'applied') ? 'applied' : 'partly_applied',
        proposals: cards,
        parcels: plan.proposals.flatMap((p) => p.parcels).map((p) => ({ number: p.number, rows: p.rows, seatsPerRow: p.seatsPerRow, paired: p.paired, confidence: p.confidence, warnings: p.warnings })),
        dropped: plan.dropped,
        warnings,
        ...(failed.length ? { failed } : {}),
        instruction: `${APPLIED_INSTRUCTION} ${cards.length > 1 ? `There are ${cards.length} cards (one change holds at most 1200 sunbeds); each was applied on its own. ` : ''}Give each parcel's confidence, mention the warnings (overlaps, sea, hidden beds) and any parcels left out for low confidence, and tell the user to check the result against the photo (Undo reverts a card). Cards with a failure are listed under failed.`,
      }
    },
  })
}

export const requestPhotoAlignment = createRequestPhotoAlignment()
export const proposeLayoutFromPhoto = createProposeLayoutFromPhoto()
