/**
 * GET /api/assistant/uploads/[id] -- an upload is only ever served to its own account (sudo aside),
 * and every "not yours / gone" case is the same 404 (track 030 S6b).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn() }))
vi.mock('@repo/data/assistant', () => ({ getUploadForAccount: vi.fn() }))
vi.mock('@/lib/assistant/uploads', () => ({ readUploadBlob: vi.fn() }))

import { GET } from './route'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getUploadForAccount } from '@repo/data/assistant'
import { readUploadBlob } from '@/lib/assistant/uploads'

const mockAuth = vi.mocked(auth)
const call = (id = 'up-1') => GET(new Request(`http://localhost/api/assistant/uploads/${id}`), { params: Promise.resolve({ id }) })
const row = (over: Record<string, unknown> = {}) =>
  ({ id: 'up-1', accountId: 'owner', url: 'https://blob/x', mime: 'image/png', expiresAt: new Date(Date.now() + 3600_000), ...over }) as never

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as never)
  vi.mocked(getUploadForAccount).mockResolvedValue(null)
  vi.mocked(prisma.assistantUpload.findFirst).mockResolvedValue(null)
  vi.mocked(readUploadBlob).mockResolvedValue(Buffer.from([1, 2, 3]))
})

describe('GET /api/assistant/uploads/[id]', () => {
  it('401 without a session, and reads nothing', async () => {
    const res = await call()
    expect(res.status).toBe(401)
    expect(getUploadForAccount).not.toHaveBeenCalled()
    expect(readUploadBlob).not.toHaveBeenCalled()
  })

  it("404 for another account's upload (the lookup is scoped to the session user)", async () => {
    mockAuth.mockResolvedValue({ user: { id: 'intruder' } } as never)
    const res = await call()
    expect(res.status).toBe(404)
    expect(getUploadForAccount).toHaveBeenCalledWith('up-1', 'intruder')
    expect(readUploadBlob).not.toHaveBeenCalled()
  })

  it('serves the owner their bytes, typed and privately cached', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'owner' } } as never)
    vi.mocked(getUploadForAccount).mockResolvedValue(row())
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toMatch(/^private/)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3])
  })

  it('404 for an expired upload even though the row still exists', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'owner' } } as never)
    vi.mocked(getUploadForAccount).mockResolvedValue(row({ expiresAt: new Date(Date.now() - 1000) }))
    expect((await call()).status).toBe(404)
    expect(readUploadBlob).not.toHaveBeenCalled()
  })

  it('404 when the blob is gone', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'owner' } } as never)
    vi.mocked(getUploadForAccount).mockResolvedValue(row())
    vi.mocked(readUploadBlob).mockRejectedValue(new Error('gone'))
    expect((await call()).status).toBe(404)
  })

  it("a platform sudo may read another account's upload; a non-sudo may not", async () => {
    mockAuth.mockResolvedValue({ user: { id: 'support' } } as never)
    vi.mocked(prisma.assistantUpload.findFirst).mockResolvedValue(row())
    expect((await call()).status).toBe(404)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: true } as never)
    expect((await call()).status).toBe(200)
  })
})
