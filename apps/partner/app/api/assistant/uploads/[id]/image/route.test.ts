/**
 * GET /api/assistant/uploads/[id]/image (track 030 S7). Requirements: only the upload's owner (or a
 * sudo) on the owning site gets the overlay image; foreign / other-site / expired / non-image all
 * answer the same 404 without reading the blob; the image comes in the shared aerial frame with its
 * size in `X-Image-Size`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn() }))
vi.mock('@repo/data/assistant', () => ({ getUploadForAccount: vi.fn() }))
vi.mock('@/lib/assistant/uploads', () => ({ readUploadBlob: vi.fn() }))

import sharp from 'sharp'
import { GET } from './route'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getUploadForAccount } from '@repo/data/assistant'
import { readUploadBlob } from '@/lib/assistant/uploads'

const OWNER = 'owner-1'
const row = (over: Record<string, unknown> = {}) =>
  ({ id: 'up1', accountId: OWNER, siteId: 'site-1', url: 'https://blob/x', mime: 'image/png', expiresAt: new Date(Date.now() + 3600_000), ...over }) as never
const call = (id = 'up1') => GET(new Request(`http://localhost/api/assistant/uploads/${id}/image`), { params: Promise.resolve({ id }) })

let big: Buffer
beforeEach(async () => {
  vi.clearAllMocks()
  big ??= await sharp({ create: { width: 3000, height: 1500, channels: 3, background: '#88c' } }).png().toBuffer()
  vi.mocked(auth).mockResolvedValue({ user: { id: OWNER } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as never)
  vi.mocked(prisma.site.findUnique).mockResolvedValue({ id: 'site-1', userId: OWNER, layoutMode: 'geo', locationLat: '1', locationLng: '2' } as never)
  vi.mocked(prisma.assistantUpload.findFirst).mockResolvedValue(null)
  vi.mocked(getUploadForAccount).mockResolvedValue(row())
  vi.mocked(readUploadBlob).mockResolvedValue(big)
})

describe('GET /api/assistant/uploads/[id]/image', () => {
  it('401 without a session', async () => {
    vi.mocked(auth).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(readUploadBlob).not.toHaveBeenCalled()
  })

  it.each([
    ['foreign upload', () => vi.mocked(getUploadForAccount).mockResolvedValue(null)],
    ['upload on a site the caller does not own', () => vi.mocked(prisma.site.findUnique).mockResolvedValue({ id: 'site-1', userId: 'other' } as never)],
    ['expired upload', () => vi.mocked(getUploadForAccount).mockResolvedValue(row({ expiresAt: new Date(Date.now() - 1) }))],
    ['a PDF', () => vi.mocked(getUploadForAccount).mockResolvedValue(row({ mime: 'application/pdf' }))],
  ])('404 for a %s, without reading the blob', async (_n, arrange) => {
    arrange()
    expect((await call()).status).toBe(404)
    expect(readUploadBlob).not.toHaveBeenCalled()
  })

  it('serves the owner a JPEG downscaled to a 2000 px long edge, with X-Image-Size, privately cached', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('x-image-size')).toBe('2000x1000')
    expect(res.headers.get('cache-control')).toMatch(/^private/)
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata()
    expect([meta.width, meta.height, meta.format]).toEqual([2000, 1000, 'jpeg'])
  })

  it('404 when the blob is gone', async () => {
    vi.mocked(readUploadBlob).mockRejectedValue(new Error('gone'))
    expect((await call()).status).toBe(404)
  })
})
