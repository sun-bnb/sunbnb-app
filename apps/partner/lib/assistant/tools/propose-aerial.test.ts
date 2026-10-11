/**
 * request_photo_alignment / propose_layout_from_photo (track 030 S7). Requirements: map-layout sites
 * only (schematic -> point to plan extraction); a foreign / other-site / non-image upload never gets
 * read; an oblique photo is refused with "ask for top-down"; alignment emits `align_photo` and changes
 * nothing; proposing needs a saved georef AND a done reading (else guidance, nothing proposed); a done
 * reading becomes inventory_batch proposal(s) numbered from max + 1, split at 1200 sunbeds, with
 * per-parcel confidence on the card and a note when the coastline could not be checked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@vercel/blob', () => ({ put: vi.fn(), del: vi.fn(), get: vi.fn() }))
vi.mock('@/app/sites/[id]/inventory/actions', () => ({
  syncChairsWithLayout: vi.fn(), moveParcel: vi.fn(), moveItems: vi.fn(), rotateSelection: vi.fn(), adjustItemSpacing: vi.fn(),
  reverseParcelNumbering: vi.fn(), reverseParcelOrientation: vi.fn(),
}))
vi.mock('@/app/sites/[id]/inventory/parcel-ops', () => ({ applyParcelConfig: vi.fn(), rotateParcel: vi.fn(), rotateUnit: vi.fn(), setSeatsStatus: vi.fn() }))
vi.mock('@/app/sites/[id]/inventory-actions', () => ({ deleteInventoryItems: vi.fn(), deleteItemsByGroup: vi.fn() }))
vi.mock('@/app/sites/[id]/schematic/actions', () => ({ createLayoutElement: vi.fn(), updateLayoutElement: vi.fn(), deleteLayoutElement: vi.fn() }))
vi.mock('@/app/sites/[id]/site-actions', () => ({ saveLayoutDimensions: vi.fn() }))
vi.mock('@repo/data/assistant', () => ({ getUploadForAccount: vi.fn(), createProposal: vi.fn() }))
vi.mock('../proposals/act', () => ({ createAndApply: vi.fn() }))
vi.mock('../proposals/handlers/inventory', async (orig) => ({ ...(await orig<typeof import('../proposals/handlers/inventory')>()), planInventory: vi.fn() }))

import { executeToolCall } from '@repo/agent/loop'
import type { AerialDescriptorV1, AerialParcelV1 } from '@repo/agent/vision/aerial-schema'
import { auth } from '@/app/auth'
import { getUploadForAccount } from '@repo/data/assistant'
import prisma from '@repo/data/PrismaCient'
import { createAndApply } from '../proposals/act'
import { planInventory } from '../proposals/handlers/inventory'
import type { InvOp } from '../proposals/inventory-sim'
import type { AssistantToolCtx } from './helpers'
import { createProposeLayoutFromPhoto, createRequestPhotoAlignment, type AerialToolDeps } from './propose-aerial'

const OWNER = 'owner-1'
const SITE = 'site-1'
const GEOREF = { kind: 'similarity', anchorPx: { x: 0, y: 0 }, anchor: { lat: 36.7, lng: -4.4 }, metersPerPx: 0.05, rotationDeg: 0 }

function block(id: string, rows: number, units: number, x0 = 100): AerialParcelV1 {
  return {
    id, facing: 'sea', confidence: 0.9,
    rows: Array.from({ length: rows }, (_, r) => ({ first: { x: x0, y: 100 + r * 80 }, last: { x: x0 + (units - 1) * 40, y: 100 + r * 80 }, units, paired: false, occludedBeds: 0, confidence: 0.9 })),
  }
}
const descriptor = (parcels: AerialParcelV1[], over: Partial<AerialDescriptorV1> = {}): AerialDescriptorV1 => ({
  image: { w: 4000, h: 4000 }, view: 'nadir', usable: true, bed: { lengthPx: 42, widthPx: 17 },
  shoreline: { points: [], seaSide: 'top' }, parcels, ignored: [], ...over,
})
const row = (over: Record<string, unknown> = {}) =>
  ({ id: 'up1', accountId: OWNER, siteId: SITE, url: 'https://blob/x', mime: 'image/jpeg', expiresAt: new Date(Date.now() + 3600_000), georef: null, aerial: null, ...over }) as never

const deps = (): AerialToolDeps => ({
  read: vi.fn().mockResolvedValue(Buffer.from('orig')),
  meta: vi.fn().mockResolvedValue({ dji: null, focal35mm: null }),
  imageSize: vi.fn().mockResolvedValue({ w: 2000, h: 1500 }),
  shore: vi.fn().mockResolvedValue(null),
})

let d: AerialToolDeps
let emit: ReturnType<typeof vi.fn>
let ctx: AssistantToolCtx
async function run(tool: 'align' | 'propose', input: Record<string, unknown>) {
  const t = tool === 'align' ? createRequestPhotoAlignment(d) : createProposeLayoutFromPhoto(d)
  const ex = await executeToolCall([t], { id: 't', name: t.name, arguments: JSON.stringify(input) }, ctx)
  expect(ex.errors).toEqual([])
  return ex.result as Record<string, any>
}

beforeEach(() => {
  vi.clearAllMocks()
  d = deps()
  emit = vi.fn()
  ctx = { session: { user: { id: OWNER } }, accountId: OWNER, siteId: SITE, locale: 'en', conversationId: 'c1', emit }
  vi.mocked(auth).mockResolvedValue({ user: { id: OWNER } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as never)
  vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER, layoutMode: 'geo', locationLat: '36.7', locationLng: '-4.4' } as never)
  vi.mocked(getUploadForAccount).mockResolvedValue(row())
  vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.inventoryItem.aggregate).mockResolvedValue({ _max: { group: 4 } } as never)
  vi.mocked(planInventory).mockImplementation(async (_s, ops) => ({ payload: { ops } }))
  let n = 0
  vi.mocked(createAndApply).mockImplementation(async () => ({ ok: true, applied: true, appliedAt: 1, card: { actionId: `a${++n}`, kind: 'inventory_batch', summary: 's', preview: { changes: [] } } }))
})

describe('request_photo_alignment', () => {
  it('schematic site: refuses and points to plan extraction, reads nothing', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER, layoutMode: 'schematic', locationLat: '0', locationLng: '0' } as never)
    const r = await run('align', { upload_id: 'up1' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/extract_schematic_from_plan/)
    expect(d.read).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it.each([
    ['foreign upload', null],
    ['upload on another site', row({ siteId: 'site-2' })],
    ['expired upload', row({ expiresAt: new Date(Date.now() - 1) })],
  ])('%s reads as gone and is never read', async (_n, value) => {
    vi.mocked(getUploadForAccount).mockResolvedValue(value as never)
    const r = await run('align', { upload_id: 'up1' })
    expect(r.error).toMatch(/no longer available/)
    expect(getUploadForAccount).toHaveBeenCalledWith('up1', OWNER)
    expect(d.read).not.toHaveBeenCalled()
  })

  it('HEIC: asks for JPEG / PNG', async () => {
    vi.mocked(getUploadForAccount).mockResolvedValue(row({ mime: 'image/heic' }))
    expect((await run('align', { upload_id: 'up1' })).error).toMatch(/JPEG or PNG/)
  })

  it('an oblique drone shot is refused with "ask for top-down", no alignment opened', async () => {
    vi.mocked(d.meta).mockResolvedValue({ dji: { lat: 36.7, lng: -4.4, relAltM: 50, yawDeg: 0, pitchDeg: -40, nadir: false }, focal35mm: 24 })
    const r = await run('align', { upload_id: 'up1' })
    expect(r.error).toMatch(/TOP-DOWN/)
    expect(r.error).toMatch(/Never suggest satellite/)
    expect(emit).not.toHaveBeenCalled()
  })

  it('emits align_photo with the seed + image size and tells the model to wait', async () => {
    vi.mocked(d.meta).mockResolvedValue({ dji: { lat: 36.7002, lng: -4.4002, relAltM: 50, yawDeg: 45, pitchDeg: -90, nadir: true }, focal35mm: 24 })
    const r = await run('align', { upload_id: 'up1' })
    expect(r).toMatchObject({ ok: true, status: 'aligning', seedSource: 'dji' })
    expect(r.instruction).toMatch(/STOP and wait/)
    expect(emit).toHaveBeenCalledWith('align_photo', {
      uploadId: 'up1', image: { w: 2000, h: 1500 },
      seed: expect.objectContaining({ kind: 'similarity', anchor: { lat: 36.7002, lng: -4.4002 }, rotationDeg: 45 }),
    })
    expect(createAndApply).not.toHaveBeenCalled()
  })
})

describe('propose_layout_from_photo', () => {
  it('without a saved georef: asks to align first, proposes nothing', async () => {
    const r = await run('propose', { upload_id: 'up1' })
    expect(r).toMatchObject({ ok: true, status: 'needs_alignment' })
    expect(createAndApply).not.toHaveBeenCalled()
  })

  it.each([
    ['not started', null],
    ['running', { status: 'running', startedAt: 't' }],
  ])('reading %s: says it is still reading, proposes nothing', async (_n, aerial) => {
    vi.mocked(getUploadForAccount).mockResolvedValue(row({ georef: GEOREF, aerial }))
    expect(await run('propose', { upload_id: 'up1' })).toMatchObject({ ok: true, status: 'reading' })
    expect(createAndApply).not.toHaveBeenCalled()
  })

  it('a reading refused by the daily limit says so', async () => {
    vi.mocked(getUploadForAccount).mockResolvedValue(row({ georef: GEOREF, aerial: { status: 'failed', startedAt: 't', error: 'aerial_limit' } }))
    expect((await run('propose', { upload_id: 'up1' })).error).toMatch(/^extraction_limit/)
  })

  it('an oblique reading is refused with "ask for top-down"', async () => {
    vi.mocked(getUploadForAccount).mockResolvedValue(row({ georef: GEOREF, aerial: { status: 'done', startedAt: 't', descriptor: descriptor([block('A', 2, 4)], { view: 'oblique' }) } }))
    expect((await run('propose', { upload_id: 'up1' })).error).toMatch(/TOP-DOWN/)
    expect(createAndApply).not.toHaveBeenCalled()
  })

  it('done: one inventory_batch proposal, parcels numbered from max + 1, confidence per parcel on the card', async () => {
    vi.mocked(getUploadForAccount).mockResolvedValue(row({ georef: GEOREF, aerial: { status: 'done', startedAt: 't', descriptor: descriptor([block('A', 3, 10), block('B', 2, 5, 1000)]) } }))
    const r = await run('propose', { upload_id: 'up1' })
    expect(r).toMatchObject({ ok: true, status: 'applied', proposals: [{ actionId: 'a1', parcels: [5, 6], status: 'applied' }] })
    const ops = vi.mocked(planInventory).mock.calls[0]![1] as InvOp[]
    expect(ops.filter((o) => o.op === 'create_parcel').map((o) => (o as { number: number }).number)).toEqual([5, 6])
    const [, , , warnings] = vi.mocked(createAndApply).mock.calls[0]!
    expect(warnings!.join('\n')).toMatch(/Parcel 5: 3 x 10 \(30 sunbeds\), confidence \d+%/)
    expect(warnings!.join('\n')).toMatch(/coastline could not be checked/)
    expect(d.shore).toHaveBeenCalledWith(GEOREF.anchor)
  })

  it('a beach over 1200 sunbeds becomes several proposals', async () => {
    vi.mocked(getUploadForAccount).mockResolvedValue(row({ georef: GEOREF, aerial: { status: 'done', startedAt: 't', descriptor: descriptor([block('BIG', 30, 60)]) } }))
    const r = await run('propose', { upload_id: 'up1' })
    expect(r.ok).toBe(true)
    expect(createAndApply).toHaveBeenCalledTimes(r.proposals.length)
    expect(r.proposals.length).toBeGreaterThan(1)
    expect(r.parcels.reduce((n: number, p: { rows: number; seatsPerRow: number }) => n + p.rows * p.seatsPerRow, 0)).toBe(1800)
  })

  it('nothing above min_confidence: no proposal', async () => {
    vi.mocked(getUploadForAccount).mockResolvedValue(row({ georef: GEOREF, aerial: { status: 'done', startedAt: 't', descriptor: descriptor([block('A', 2, 4)]) } }))
    const r = await run('propose', { upload_id: 'up1', min_confidence: 1 })
    expect(r.ok).toBe(false)
    expect(createAndApply).not.toHaveBeenCalled()
  })
})
