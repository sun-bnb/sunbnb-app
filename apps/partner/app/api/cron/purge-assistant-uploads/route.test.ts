import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@repo/data/assistant', () => ({ listExpiredUploads: vi.fn(), markUploadDeleted: vi.fn() }))
vi.mock('@vercel/blob', () => ({ put: vi.fn(), get: vi.fn(), del: vi.fn() }))

import { GET } from './route'
import { del } from '@vercel/blob'
import { listExpiredUploads, markUploadDeleted } from '@repo/data/assistant'

const req = (auth = 'Bearer s3cret') => new Request('http://x/api/cron/purge-assistant-uploads', { headers: { authorization: auth } })

beforeEach(() => {
  vi.resetAllMocks()
  process.env.CRON_SECRET = 's3cret'
})
afterEach(() => {
  delete process.env.CRON_SECRET
})

describe('GET /api/cron/purge-assistant-uploads', () => {
  it('fails closed without CRON_SECRET and rejects a wrong or missing secret, touching nothing', async () => {
    delete process.env.CRON_SECRET
    expect((await GET(req())).status).toBe(503)
    process.env.CRON_SECRET = 's3cret'
    expect((await GET(req('Bearer nope'))).status).toBe(401)
    expect((await GET(new Request('http://x'))).status).toBe(401)
    expect(listExpiredUploads).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
  })

  it('deletes the blob THEN stamps the row; a failed blob delete is left for the next run', async () => {
    vi.mocked(listExpiredUploads).mockResolvedValue([
      { id: 'a', url: 'https://b/a' },
      { id: 'b', url: 'https://b/b' },
    ] as never)
    vi.mocked(del).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('blob down'))
    const res = await GET(req())
    expect(await res.json()).toEqual({ checked: 2, purged: 1, failed: 1 })
    expect(markUploadDeleted).toHaveBeenCalledTimes(1)
    expect(markUploadDeleted).toHaveBeenCalledWith('a')
  })
})
