/**
 * kind `place_image` (track 030 S6a): the assistant puts the user's uploaded photo on a site image
 * slot. Requirements under test: nothing is written while proposing; only the account's own, same-site,
 * live JPEG/PNG/WebP upload is placeable; targets are resolved by NAME inside the site; apply COPIES to a
 * public blob (never points the site at the private/purgeable upload); a changed slot is stale; undo
 * restores the previous URL + dimensions and only while the slot still shows what apply wrote.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@repo/data/assistant', () => ({ createProposal: vi.fn(), getUploadForAccount: vi.fn() }))
vi.mock('@vercel/blob', () => ({ put: vi.fn(), del: vi.fn(), get: vi.fn() }))
vi.mock('../uploads', async (orig) => ({ ...(await orig<typeof import('../uploads')>()), readUploadBlob: vi.fn() }))
vi.mock('../image-process', async (orig) => ({ ...(await orig<typeof import('../image-process')>()), processPlacedImage: vi.fn() }))

import { executeToolCall } from '@repo/agent/loop'
import { createProposal, getUploadForAccount } from '@repo/data/assistant'
import prisma from '@repo/data/PrismaCient'
import { put, del } from '@vercel/blob'
import { auth } from '@/app/auth'
import { getAssistantTools, type AssistantToolCtx } from '../tools'
import { readUploadBlob } from '../uploads'
import { processPlacedImage } from '../image-process'
import { diffBasis, ProposalError } from './types'
import { isPlacedCopy, placeImageHandler, type PlaceImagePayload } from './handlers/place-image'
import { CONV, OWNER, SITE, siteRow } from './test-support'

const tools = getAssistantTools()
const ctx: AssistantToolCtx = { session: { user: { id: OWNER } }, accountId: OWNER, siteId: SITE, locale: 'en', conversationId: CONV, emit: vi.fn() }
const hctx = { siteId: SITE, accountId: OWNER }

const UP = 'upload1'
const DEST = `sites/${SITE}/assistant/${UP}.jpg`
const PUBLIC = 'https://abc.public.blob.vercel-storage.com'
const upload = (over: Record<string, unknown> = {}) => ({
  id: UP, accountId: OWNER, siteId: SITE, blobKey: `assistant/${OWNER}/uuid/beach.jpg`,
  url: 'https://abc.private.blob.vercel-storage.com/assistant/x/beach.jpg', mime: 'image/jpeg', sizeBytes: 1000, purpose: 'photo',
  expiresAt: new Date(Date.now() + 86_400_000), deletedAt: null, ...over,
})
const site = (over: Record<string, unknown> = {}) => ({ ...siteRow(), image: null, imageWidth: null, imageHeight: null, layoutMode: 'geo', bgImageUrl: null, bgImageWidth: null, bgImageHeight: null, ...over })

async function propose(input: Record<string, unknown>) {
  vi.mocked(createProposal).mockClear()
  return executeToolCall(tools, { id: 't1', name: 'propose_place_image', arguments: JSON.stringify(input) }, ctx)
}
async function refused(input: Record<string, unknown>): Promise<string> {
  const ex = await propose(input)
  const res = (ex.accepted ? ex.result : { ok: false, errors: ex.errors }) as { ok: boolean; error?: string; errors?: string[] }
  expect(res.ok, JSON.stringify(res)).toBe(false)
  expect(createProposal).not.toHaveBeenCalled()
  return res.error ?? (res.errors ?? []).join('; ')
}

const payload = (over: Partial<PlaceImagePayload> = {}): PlaceImagePayload => ({ target: 'cover', uploadId: UP, destPath: DEST, ...over })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({ user: { id: OWNER } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as never)
  vi.mocked(prisma.site.findUnique).mockResolvedValue(site() as never)
  vi.mocked(prisma.product.findMany).mockResolvedValue([])
  vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([])
  vi.mocked(prisma.siteBrand.findUnique).mockResolvedValue(null)
  vi.mocked(createProposal).mockResolvedValue({ id: 'act-1' } as never)
  vi.mocked(getUploadForAccount).mockResolvedValue(upload() as never)
  vi.mocked(readUploadBlob).mockResolvedValue(Buffer.from('raw'))
  vi.mocked(processPlacedImage).mockResolvedValue({ data: Buffer.from('clean'), contentType: 'image/jpeg', width: 1600, height: 900 })
  vi.mocked(put).mockResolvedValue({ url: `${PUBLIC}/${DEST}` } as never)
  vi.mocked(del).mockResolvedValue(undefined as never)
})

describe('propose_place_image', () => {
  it('stores a proposal with the before/after + thumbnail data and writes nothing', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue(site({ image: 'https://old.example/cover.jpg' }) as never)
    const ex = await propose({ target: 'cover', uploadId: UP })
    const res = ex.result as Record<string, any>
    expect(res.ok, JSON.stringify(res)).toBe(true)
    expect(res.changes[0]).toMatchObject({ target: 'Cover photo', field: 'image', before: 'https://old.example/cover.jpg' })
    expect(res.changes[0].after).toContain('beach.jpg')
    const stored = vi.mocked(createProposal).mock.calls[0]![0] as any
    expect(stored.kind).toBe('place_image')
    expect(stored.payload).toEqual({ v: 1, data: { target: 'cover', uploadId: UP, destPath: DEST } })
    expect(stored.preview.image).toEqual({
      target: 'cover', targetLabel: 'Cover photo', imageUrl: upload().url, previousUrl: 'https://old.example/cover.jpg',
      uploadId: UP, fileName: 'beach.jpg',
    })
    // The title / applied note is a sentence about the file, never the blob URLs.
    expect(stored.preview.summary).toBe('Set Cover photo to beach.jpg')
    expect(stored.preview.summary).not.toMatch(/https?:|blob/)
    expect(put).not.toHaveBeenCalled()
    expect(readUploadBlob).not.toHaveBeenCalled()
    expect(prisma.site.update).not.toHaveBeenCalled()
  })

  it('resolves a product by NAME inside the site; the payload carries the name, never an id', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([{ id: 'prodCuid', name: 'Mojito', totalPrice: 8, imageUrl: null, imageWidth: null, imageHeight: null }] as never)
    const res = (await propose({ target: 'product', uploadId: UP, name: 'mojito' })).result as Record<string, any>
    expect(res.ok, JSON.stringify(res)).toBe(true)
    expect(res.changes[0].target).toBe('Product "Mojito"')
    expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { siteId: SITE, active: true } }))
    const stored = vi.mocked(createProposal).mock.calls[0]![0] as any
    expect(JSON.stringify(stored.payload)).not.toContain('prodCuid')
    expect(stored.payload.data.handle).toBe('mojito')
  })

  it('asks for disambiguation when two products share the name, and refuses an unknown one', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { id: 'a', name: 'Mojito', totalPrice: 8, imageUrl: null }, { id: 'b', name: 'Mojito', totalPrice: 9, imageUrl: null },
    ] as never)
    expect(await refused({ target: 'product', uploadId: UP, name: 'Mojito' })).toMatch(/2 products named/)
    vi.mocked(prisma.product.findMany).mockResolvedValue([])
    expect(await refused({ target: 'product', uploadId: UP, name: 'Nope' })).toMatch(/No product named/)
  })

  it('resolves a rental item by name', async () => {
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([{ id: 'r1', name: 'Kayak', imageUrl: null }] as never)
    const res = (await propose({ target: 'rental_item', uploadId: UP, name: 'Kayak' })).result as Record<string, any>
    expect(res.changes[0].target).toBe('Rental item "Kayak"')
  })

  it('requires a name for product / rental_item and rejects one for the other targets', async () => {
    expect(await refused({ target: 'product', uploadId: UP })).toMatch(/name is required/)
    expect(await refused({ target: 'rental_item', uploadId: UP })).toMatch(/name is required/)
    expect(await refused({ target: 'cover', uploadId: UP, name: 'Mojito' })).toMatch(/name is only for/)
  })

  it('refuses an unknown target and a malformed upload id', async () => {
    expect(await refused({ target: 'avatar', uploadId: UP })).toBeTruthy()
    expect(await refused({ target: 'cover', uploadId: '../etc' })).toMatch(/uploadId/)
  })

  it.each([
    ['PDF', 'application/pdf', /not documents/],
    ['DOCX', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', /not documents/],
    ['HEIC', 'image/heic', /HEIC/],
  ])('refuses a %s upload', async (_n, mime, msg) => {
    vi.mocked(getUploadForAccount).mockResolvedValue(upload({ mime }) as never)
    expect(await refused({ target: 'cover', uploadId: UP })).toMatch(msg)
  })

  it('treats a missing, other-site and expired upload alike (no cross-tenant signal)', async () => {
    const msgs: string[] = []
    vi.mocked(getUploadForAccount).mockResolvedValue(null as never)
    msgs.push(await refused({ target: 'cover', uploadId: UP }))
    vi.mocked(getUploadForAccount).mockResolvedValue(upload({ siteId: 'other-site' }) as never)
    msgs.push(await refused({ target: 'cover', uploadId: UP }))
    vi.mocked(getUploadForAccount).mockResolvedValue(upload({ expiresAt: new Date(Date.now() - 1000) }) as never)
    msgs.push(await refused({ target: 'cover', uploadId: UP }))
    expect(new Set(msgs).size).toBe(1)
    // The lookup is scoped to the SITE OWNER's account, never to an id from the model.
    expect(getUploadForAccount).toHaveBeenCalledWith(UP, OWNER)
  })

  it('refuses the schematic underlay on a map-layout site, with a stretch warning on a schematic one', async () => {
    expect(await refused({ target: 'schematic_underlay', uploadId: UP })).toMatch(/map layout/)
    vi.mocked(prisma.site.findUnique).mockResolvedValue(site({ layoutMode: 'schematic' }) as never)
    const res = (await propose({ target: 'schematic_underlay', uploadId: UP })).result as Record<string, any>
    expect(res.ok, JSON.stringify(res)).toBe(true)
    expect(res.warnings.join(' ')).toMatch(/stretched/)
  })

  it('refuses brand images when the site has no brand yet or a custom brand page', async () => {
    expect(await refused({ target: 'brand_logo', uploadId: UP })).toMatch(/no brand yet/)
    vi.mocked(prisma.siteBrand.findUnique).mockResolvedValue({ brandName: 'X', logoUrl: null, bgImageUrl: null } as never)
    vi.mocked(prisma.site.findUnique).mockResolvedValue(site({ customBrandEnabled: true, customBrandKey: 'alcudia' }) as never)
    expect(await refused({ target: 'brand_background', uploadId: UP })).toMatch(/custom brand page/)
  })

  it('says nothing would change when the slot already shows this photo', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue(site({ image: `${PUBLIC}/${DEST}?v=1` }) as never)
    expect(await refused({ target: 'cover', uploadId: UP })).toMatch(/Nothing would change/)
  })

  it('exposes no id parameter other than the upload id', () => {
    const t = tools.find((x) => x.name === 'propose_place_image')!
    expect(Object.keys(t.inputSchema.properties as object).sort()).toEqual(['name', 'target', 'uploadId'])
  })
})

describe('place_image apply / undo', () => {
  it('apply COPIES to a deterministic public blob and writes that URL + processed dimensions to the cover', async () => {
    await placeImageHandler.execute(hctx, payload(), [])
    expect(readUploadBlob).toHaveBeenCalledWith(upload().url)
    expect(put).toHaveBeenCalledWith(DEST, Buffer.from('clean'), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'image/jpeg' })
    const arg = vi.mocked(prisma.site.update).mock.calls[0]![0] as any
    expect(arg.where).toEqual({ id: SITE })
    expect(arg.data).toEqual({ image: `${PUBLIC}/${DEST}`, imageWidth: 1600, imageHeight: 900 })
    // never the private upload URL
    expect(JSON.stringify(arg.data)).not.toContain('private')
  })

  it('reports the step done only after the write succeeded', async () => {
    const done: string[] = []
    await placeImageHandler.execute(hctx, payload(), done)
    expect(done).toEqual(['image'])
  })

  it('writes the right column for each target', async () => {
    const calls = async (p: PlaceImagePayload) => { vi.clearAllMocks(); await placeImageHandler.execute(hctx, p, []) }
    vi.mocked(prisma.siteBrand.findUnique).mockResolvedValue({ id: 'b', brandName: 'X', logoUrl: null, bgImageUrl: null } as never)
    await calls(payload({ target: 'brand_logo' }))
    expect((vi.mocked(prisma.siteBrand.update).mock.calls[0]![0] as any).data).toEqual({ logoUrl: `${PUBLIC}/${DEST}` })
    await calls(payload({ target: 'brand_background' }))
    expect((vi.mocked(prisma.siteBrand.update).mock.calls[0]![0] as any).data).toEqual({ bgImageUrl: `${PUBLIC}/${DEST}`, bgImageWidth: 1600, bgImageHeight: 900 })

    vi.mocked(prisma.site.findUnique).mockResolvedValue(site({ layoutMode: 'schematic' }) as never)
    await calls(payload({ target: 'schematic_underlay' }))
    expect((vi.mocked(prisma.site.update).mock.calls[0]![0] as any).data).toEqual({ bgImageUrl: `${PUBLIC}/${DEST}`, bgImageWidth: 1600, bgImageHeight: 900 })

    vi.mocked(prisma.product.findMany).mockResolvedValue([{ id: 'p1', name: 'Mojito', totalPrice: 8, imageUrl: null }] as never)
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ siteId: SITE } as never)
    await calls(payload({ target: 'product', handle: 'Mojito' }))
    expect((vi.mocked(prisma.product.update).mock.calls[0]![0] as any)).toMatchObject({ where: { id: 'p1' }, data: { imageUrl: `${PUBLIC}/${DEST}`, imageWidth: 1600, imageHeight: 900 } })

    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([{ id: 'r1', name: 'Kayak', imageUrl: null }] as never)
    vi.mocked(prisma.rentalItem.findUnique).mockResolvedValue({ siteId: SITE } as never)
    await calls(payload({ target: 'rental_item', handle: 'Kayak' }))
    expect((vi.mocked(prisma.rentalItem.update).mock.calls[0]![0] as any)).toMatchObject({ where: { id: 'r1' }, data: { imageUrl: `${PUBLIC}/${DEST}` } })
  })

  it('does not copy or write anything when the caller no longer owns the site', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'intruder' } } as never)
    await expect(placeImageHandler.execute(hctx, payload(), [])).rejects.toBeInstanceOf(ProposalError)
    expect(put).not.toHaveBeenCalled()
    expect(prisma.site.update).not.toHaveBeenCalled()
  })

  it('removes the fresh copy and fails when the target row cannot be written (item vanished between review and apply)', async () => {
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([{ id: 'r1', name: 'Kayak', imageUrl: null }] as never)
    vi.mocked(prisma.rentalItem.findUnique).mockResolvedValue(null as never) // deleted meanwhile
    await expect(placeImageHandler.execute(hctx, payload({ target: 'rental_item', handle: 'Kayak' }), [])).rejects.toThrow(/Rental item not found/)
    expect(del).toHaveBeenCalledWith(`${PUBLIC}/${DEST}`)
  })

  it('refuses a rental/product id from another site even if a name matched', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([{ id: 'p1', name: 'Mojito', totalPrice: 8, imageUrl: null }] as never)
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ siteId: 'other-site' } as never)
    await expect(placeImageHandler.execute(hctx, payload({ target: 'product', handle: 'Mojito' }), [])).rejects.toThrow(/Product not found/)
    expect(prisma.product.update).not.toHaveBeenCalled()
  })

  it('an unreadable photo is a clean ProposalError and nothing is stored', async () => {
    vi.mocked(processPlacedImage).mockRejectedValue(new Error('corrupt'))
    await expect(placeImageHandler.execute(hctx, payload(), [])).rejects.toBeInstanceOf(ProposalError)
    expect(put).not.toHaveBeenCalled()
  })

  it('apply is stale when the slot changed after review (the before URL is part of the basis)', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue(site({ image: 'https://a/1.jpg' }) as never)
    const reviewed = await placeImageHandler.diff(hctx, payload())
    vi.mocked(prisma.site.findUnique).mockResolvedValue(site({ image: 'https://a/2.jpg' }) as never)
    const fresh = await placeImageHandler.diff(hctx, payload())
    expect(diffBasis(fresh)).not.toBe(diffBasis(reviewed))
    vi.mocked(prisma.site.findUnique).mockResolvedValue(site({ image: 'https://a/1.jpg' }) as never)
    expect(diffBasis(await placeImageHandler.diff(hctx, payload()))).toBe(diffBasis(reviewed))
  })

  it('snapshot captures the previous URL and dimensions; restore writes them back (explicit nulls clear)', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue(site({ image: 'https://old/c.jpg', imageWidth: 1200, imageHeight: 400 }) as never)
    const snap = await placeImageHandler.snapshot(hctx, payload())
    expect(snap).toEqual({ url: 'https://old/c.jpg', width: 1200, height: 400 })
    await placeImageHandler.restore(hctx, payload(), snap)
    expect((vi.mocked(prisma.site.update).mock.calls[0]![0] as any).data).toEqual({ image: 'https://old/c.jpg', imageWidth: 1200, imageHeight: 400 })

    vi.mocked(prisma.site.update).mockClear()
    await placeImageHandler.restore(hctx, payload(), { url: null, width: null, height: null })
    expect((vi.mocked(prisma.site.update).mock.calls[0]![0] as any).data).toEqual({ image: null, imageWidth: null, imageHeight: null })
  })

  it('undo is allowed only while the slot still shows the placed copy; a later manual change blocks it', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue(site({ image: `${PUBLIC}/${DEST}` }) as never)
    expect((await placeImageHandler.diff(hctx, payload(), { applied: true })).changes).toEqual([])
    vi.mocked(prisma.site.findUnique).mockResolvedValue(site({ image: 'https://someone-elses/new.jpg' }) as never)
    expect((await placeImageHandler.diff(hctx, payload(), { applied: true })).changes).toHaveLength(1)
  })

  it('undo verification does not need the upload (it may be purged by then)', async () => {
    vi.mocked(getUploadForAccount).mockResolvedValue(null as never)
    vi.mocked(prisma.site.findUnique).mockResolvedValue(site({ image: `${PUBLIC}/${DEST}` }) as never)
    await expect(placeImageHandler.diff(hctx, payload(), { applied: true })).resolves.toEqual({ changes: [] })
  })
})

describe('isPlacedCopy', () => {
  it('matches the deterministic path regardless of host or query, and nothing else', () => {
    expect(isPlacedCopy(`${PUBLIC}/${DEST}?download=1`, DEST)).toBe(true)
    expect(isPlacedCopy(`${PUBLIC}/sites/${SITE}/assistant/other.jpg`, DEST)).toBe(false)
    expect(isPlacedCopy(`${PUBLIC}/evil/${DEST}`, DEST)).toBe(false)
    expect(isPlacedCopy(null, DEST)).toBe(false)
    expect(isPlacedCopy('not a url', DEST)).toBe(false)
  })
})

describe('page context carries the attachment ids (the model cannot place a photo it cannot name)', () => {
  it('lists uploadId / name / kind of the verified attachments inside the stripped context block', async () => {
    const { renderPageContext } = await import('../context')
    const { stripContext } = await import('../transcript')
    const block = await renderPageContext({}, SITE, [{ id: UP, name: 'beach.jpg', kind: 'photo' }])
    expect(JSON.parse(block.replace('<page_context>', '').replace('</page_context>', ''))).toEqual({ attachments: [{ uploadId: UP, name: 'beach.jpg', kind: 'photo' }] })
    expect(stripContext(`${block}\n\nuse this as the cover`)).toBe('use this as the cover')
    expect(await renderPageContext({}, SITE)).toBe('')
  })
})
