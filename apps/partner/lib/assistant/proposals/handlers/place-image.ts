/**
 * kind `place_image` (track 030 S6a) -- put one of the user's uploaded photos on a site image slot:
 * cover, product image, rental item image, brand logo, brand background, schematic underlay.
 *
 * Design:
 *  - The payload holds the upload id, the target slot and (product / rental item) the item NAME --
 *    never a row id. The slot is resolved inside the site on every diff / execute / restore.
 *  - COPY ON APPLY. The AssistantUpload blob is private-capable and purged after 30 days, so the
 *    site image must not point at it. Apply reads the upload, strips metadata (EXIF GPS) + caps the
 *    size (`image-process.ts`) and `put()`s a PUBLIC blob at a DETERMINISTIC path
 *    `sites/{siteId}/assistant/{uploadId}.{ext}` (no random suffix, overwrite allowed): re-applying is
 *    idempotent, and the undo check can recognise "the slot still shows what I wrote" by URL path.
 *  - Staleness: apply = the slot's current URL equals the one the user reviewed (it is in the diff's
 *    `before`); undo = the slot's URL still ends with `destPath`. Undo restores the previous URL and
 *    dimensions from the snapshot. The new blob is NOT deleted on undo (v1): it is one capped image
 *    at a path a re-apply would overwrite anyway, and deleting would break any cached/open page that
 *    still shows it. The previous blob is never touched, so restoring it is always safe.
 */
import { del, put } from '@vercel/blob'
import { getUploadForAccount } from '@repo/data/assistant'
import { resolveBrandRender } from '@repo/data/brand-manifest'
import prisma from '@repo/data/PrismaCient'
import { requireSiteOwner } from '@/lib/auth-helpers'
import {
  setBrandImage,
  setProductImage,
  setRentalItemImage,
  setSchematicUnderlay,
  setSiteCover,
  type ImageWrite,
} from '@/lib/site-images'
import { ID } from '../../request'
import { EXT_BY_MIME, isPlaceableMime, processPlacedImage } from '../../image-process'
import { nameFromBlobKey, readUploadBlob } from '../../uploads'
import { ProposalError, type Diff, type HandlerCtx, type KindHandler } from '../types'

export const PLACE_TARGETS = ['cover', 'product', 'rental_item', 'brand_logo', 'brand_background', 'schematic_underlay'] as const
export type PlaceTarget = (typeof PLACE_TARGETS)[number]

export interface PlaceImagePayload {
  target: PlaceTarget
  /** Product / rental item NAME (required for those two targets, absent otherwise). */
  handle?: string
  uploadId: string
  /** Where the public copy lives; deterministic from (siteId, uploadId, mime). */
  destPath: string
}

export interface PlaceImageSnapshot {
  url: string | null
  width: number | null
  height: number | null
}

interface Slot {
  /** Display target, e.g. `Product "Mojito"`. */
  label: string
  url: string | null
  width: number | null
  height: number | null
  write: (url: string | null, dims?: { width?: number | null; height?: number | null }) => Promise<ImageWrite>
}

const key = (name: string) => name.trim().toLowerCase()
const SLOT_NAME: Record<PlaceTarget, string> = {
  cover: 'Cover photo',
  product: 'Product',
  rental_item: 'Rental item',
  brand_logo: 'Brand logo',
  brand_background: 'Brand background',
  schematic_underlay: 'Schematic underlay',
}

/** "Set Cover photo to beach.jpg": never embeds a URL (it is the card title and the applied note). */
export function placeImageSummary(target: PlaceTarget, label: string, fileName: string): string {
  const noun = target === 'product' || target === 'rental_item' ? `${label} image` : label
  return `Set ${noun} to ${fileName}`
}

export function placeDestPath(siteId: string, uploadId: string, mime: string): string | null {
  return isPlaceableMime(mime) ? `sites/${siteId}/assistant/${uploadId}.${EXT_BY_MIME[mime]}` : null
}

/** Validated upload for placement: this account, this site, alive, JPEG/PNG/WebP. */
async function loadPlaceableUpload(ctx: HandlerCtx, uploadId: string) {
  const row = await getUploadForAccount(uploadId, ctx.accountId)
  // Same answer for missing / foreign / purged / other-site: nothing about other accounts leaks.
  if (!row || row.siteId !== ctx.siteId || row.expiresAt.getTime() <= Date.now()) {
    throw new ProposalError('That attachment is no longer available: ask the user to attach the photo again')
  }
  if (!isPlaceableMime(row.mime)) {
    throw new ProposalError(
      row.mime.startsWith('image/')
        ? 'Only JPEG, PNG or WebP photos can be placed (HEIC is not supported): ask the user to send it as JPEG or PNG'
        : 'Only photos (JPEG, PNG, WebP) can be placed on the site, not documents',
    )
  }
  return { row, mime: row.mime, name: nameFromBlobKey(row.blobKey) }
}

export async function planPlaceImage(
  input: Record<string, unknown>,
  ctx: HandlerCtx,
): Promise<{ payload: PlaceImagePayload; warnings: string[] } | { errors: string[] }> {
  const target = input.target
  if (typeof target !== 'string' || !(PLACE_TARGETS as readonly string[]).includes(target)) {
    return { errors: [`target must be one of: ${PLACE_TARGETS.join(', ')}`] }
  }
  const t = target as PlaceTarget
  if (typeof input.uploadId !== 'string' || !ID.test(input.uploadId)) return { errors: ['uploadId is required (the id of the attached photo)'] }

  const needsHandle = t === 'product' || t === 'rental_item'
  const handle = typeof input.name === 'string' ? input.name.trim() : ''
  if (needsHandle && (!handle || handle.length > 200)) {
    return { errors: [`name is required for ${t === 'product' ? 'a product' : 'a rental item'} image: the item's name`] }
  }
  if (!needsHandle && input.name !== undefined && handle) return { errors: [`name is only for product / rental_item targets, not ${t}`] }

  let upload: Awaited<ReturnType<typeof loadPlaceableUpload>>
  try {
    upload = await loadPlaceableUpload(ctx, input.uploadId)
  } catch (err) {
    if (err instanceof ProposalError) return { errors: [err.message] }
    throw err
  }
  const destPath = placeDestPath(ctx.siteId, input.uploadId, upload.mime)!
  const warnings: string[] = []
  if (t === 'schematic_underlay') warnings.push('The photo is stretched over the whole schematic canvas, so it only lines up if its proportions match the canvas')
  return { payload: { target: t, ...(needsHandle ? { handle } : {}), uploadId: input.uploadId, destPath }, warnings }
}

// ─── slot resolution ────────────────────────────────────────────────────────

async function resolveSlot(ctx: HandlerCtx, p: PlaceImagePayload): Promise<Slot> {
  const { siteId } = ctx
  switch (p.target) {
    case 'cover': {
      const s = await prisma.site.findUnique({ where: { id: siteId }, select: { image: true, imageWidth: true, imageHeight: true } })
      if (!s) throw new ProposalError('Site not found')
      return {
        label: SLOT_NAME.cover, url: s.image ?? null, width: s.imageWidth ?? null, height: s.imageHeight ?? null,
        write: (url, dims) => setSiteCover(siteId, url, dims),
      }
    }
    case 'schematic_underlay': {
      const s = await prisma.site.findUnique({ where: { id: siteId }, select: { layoutMode: true, bgImageUrl: true, bgImageWidth: true, bgImageHeight: true } })
      if (!s) throw new ProposalError('Site not found')
      if (s.layoutMode !== 'schematic') throw new ProposalError('This site uses the map layout: an underlay image only exists on schematic sites')
      return {
        label: SLOT_NAME.schematic_underlay, url: s.bgImageUrl ?? null, width: s.bgImageWidth ?? null, height: s.bgImageHeight ?? null,
        write: (url, dims) => setSchematicUnderlay(siteId, url, dims),
      }
    }
    case 'brand_logo':
    case 'brand_background': {
      const [site, brand] = await Promise.all([
        prisma.site.findUnique({ where: { id: siteId }, select: { customBrandEnabled: true, customBrandKey: true, slug: true } }),
        prisma.siteBrand.findUnique({ where: { siteId } }),
      ])
      if (!site) throw new ProposalError('Site not found')
      if (resolveBrandRender(site).mode === 'custom') {
        throw new ProposalError('This site uses a custom brand page: its appearance is set in code, not in the Brand tab, so I cannot change it')
      }
      if (!brand) throw new ProposalError('This site has no brand yet: a brand name must be set first (propose_brand)')
      const logo = p.target === 'brand_logo'
      return {
        label: SLOT_NAME[p.target],
        url: (logo ? brand.logoUrl : brand.bgImageUrl) ?? null,
        width: logo ? null : (brand.bgImageWidth ?? null),
        height: logo ? null : (brand.bgImageHeight ?? null),
        write: (url, dims) => setBrandImage(siteId, logo ? 'logo' : 'background', url, dims),
      }
    }
    case 'product': {
      const rows = await prisma.product.findMany({
        where: { siteId, active: true },
        select: { id: true, name: true, totalPrice: true, imageUrl: true, imageWidth: true, imageHeight: true },
      })
      const hits = rows.filter((r) => key(r.name) === key(p.handle ?? ''))
      if (hits.length === 0) throw new ProposalError(`No product named "${p.handle}": check the name with list_products`)
      if (hits.length > 1) {
        throw new ProposalError(`There are ${hits.length} products named "${p.handle}" (${hits.map((h) => h.totalPrice).join(' / ')}). Ask the user which one, or to rename one in the Products tab`)
      }
      const row = hits[0]!
      return {
        label: `Product "${row.name}"`, url: row.imageUrl ?? null, width: row.imageWidth ?? null, height: row.imageHeight ?? null,
        write: (url, dims) => setProductImage(siteId, row.id, url, dims),
      }
    }
    case 'rental_item': {
      const rows = await prisma.rentalItem.findMany({ where: { siteId }, select: { id: true, name: true, imageUrl: true } })
      const hits = rows.filter((r) => key(r.name) === key(p.handle ?? ''))
      if (hits.length === 0) throw new ProposalError(`No rental item named "${p.handle}": check the name with list_rental_items`)
      if (hits.length > 1) throw new ProposalError(`There are ${hits.length} rental items named "${p.handle}". Ask the user which one, or to rename one in the Rentals tab`)
      const row = hits[0]!
      return {
        label: `Rental item "${row.name}"`, url: row.imageUrl ?? null, width: null, height: null,
        write: (url) => setRentalItemImage(siteId, row.id, url),
      }
    }
  }
}

/** True when `url` is the public copy this payload writes (deterministic path, query ignored). */
export function isPlacedCopy(url: string | null, destPath: string): boolean {
  if (!url) return false
  try {
    return decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '') === destPath
  } catch {
    return false
  }
}

// ─── handler ────────────────────────────────────────────────────────────────

export const placeImageHandler: KindHandler<PlaceImagePayload, PlaceImageSnapshot> = {
  kind: 'place_image',

  async diff(ctx, payload, opts): Promise<Diff> {
    const slot = await resolveSlot(ctx, payload)
    const placed = isPlacedCopy(slot.url, payload.destPath)
    if (opts?.applied) {
      // Undo check: still showing what apply wrote -> nothing differs from the applied state.
      if (placed) return { changes: [] }
      return { changes: [{ target: slot.label, field: 'image', label: 'Image', before: slot.url, after: 'the placed photo' }] }
    }
    const upload = await loadPlaceableUpload(ctx, payload.uploadId)
    if (placed) return { changes: [] }
    return {
      changes: [{ target: slot.label, field: 'image', label: 'Image', before: slot.url, after: `photo "${upload.name}"` }],
      image: {
        target: payload.target, targetLabel: slot.label, imageUrl: upload.row.url, previousUrl: slot.url,
        uploadId: payload.uploadId, fileName: upload.name, ...(payload.handle ? { itemName: payload.handle } : {}),
      },
      summary: placeImageSummary(payload.target, slot.label, upload.name),
    }
  },

  async snapshot(ctx, payload) {
    const slot = await resolveSlot(ctx, payload)
    return { url: slot.url, width: slot.width, height: slot.height }
  },

  async execute(ctx, payload, done) {
    const { error } = await requireSiteOwner(ctx.siteId)
    if (error) throw new ProposalError(error)
    const slot = await resolveSlot(ctx, payload)
    const upload = await loadPlaceableUpload(ctx, payload.uploadId)
    if (placeDestPath(ctx.siteId, payload.uploadId, upload.mime) !== payload.destPath) {
      throw new ProposalError('The attachment changed after this was proposed')
    }

    let processed
    try {
      processed = await processPlacedImage(await readUploadBlob(upload.row.url), upload.mime as 'image/jpeg')
    } catch (err) {
      console.error('[assistant] place_image could not read / decode the upload', err)
      throw new ProposalError('The photo could not be read: ask the user to attach it again (JPEG or PNG)')
    }
    const blob = await put(payload.destPath, processed.data, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: processed.contentType,
    })
    const written = await slot.write(blob.url, { width: processed.width, height: processed.height })
    if (!written.ok) {
      // Nothing references the copy yet; do not leave it orphaned (unless it pre-existed as the slot's own image).
      if (!isPlacedCopy(slot.url, payload.destPath)) await del(blob.url).catch(() => undefined)
      throw new ProposalError(written.error)
    }
    done.push('image')
  },

  async restore(ctx, payload, snapshot) {
    const slot = await resolveSlot(ctx, payload)
    const r = await slot.write(snapshot.url, { width: snapshot.width, height: snapshot.height })
    if (!r.ok) throw new ProposalError(r.error)
  },
}
