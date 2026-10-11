/** uploadAssistantFile -- validation, scoping and limits (track 030 S5). Ownership runs through the REAL requireSiteOwner. */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn() }))
vi.mock('@repo/data/flags', () => ({ getFlagStates: vi.fn() }))
vi.mock('@repo/data/rate-limit-shared', () => ({ rateLimitShared: vi.fn() }))
vi.mock('@repo/data/assistant', () => ({ createUpload: vi.fn() }))
vi.mock('@vercel/blob', () => ({ put: vi.fn(), get: vi.fn(), del: vi.fn() }))
vi.mock('sharp', () => ({
  default: vi.fn().mockReturnValue({ metadata: vi.fn().mockResolvedValue({ width: 10 }), resize: vi.fn().mockReturnThis(), jpeg: vi.fn().mockReturnThis(), toBuffer: vi.fn().mockRejectedValue(new Error('no heif')) }),
}))

import { uploadAssistantFile } from './upload-actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getFlagStates } from '@repo/data/flags'
import { rateLimitShared } from '@repo/data/rate-limit-shared'
import { createUpload } from '@repo/data/assistant'
import { put } from '@vercel/blob'

const OWNER = 'owner-1'
const SITE = 'site-1'
const saved = { ...process.env }

const pdf = (extra = 'body') => new File([`%PDF-1.4 ${extra}`], 'Tarifas.pdf', { type: 'application/pdf' })
const form = (f: File, kind?: string) => {
  const fd = new FormData()
  fd.append('file', f)
  if (kind) fd.append('kind', kind)
  return fd
}

beforeEach(() => {
  vi.resetAllMocks()
  process.env.PARTNER_ASSISTANT_ENABLED = '1'
  process.env.ANTHROPIC_API_KEY = 'k'
  vi.mocked(auth).mockResolvedValue({ user: { id: OWNER } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as never)
  vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER } as never)
  vi.mocked(getFlagStates).mockResolvedValue({ assistant: { enabled: true } } as never)
  vi.mocked(rateLimitShared).mockResolvedValue({ allowed: true, count: 1 })
  vi.mocked(put).mockResolvedValue({ url: 'https://b/x' } as never)
  vi.mocked(createUpload).mockResolvedValue({ id: 'up-1' } as never)
})
afterEach(() => {
  process.env = { ...saved }
})

describe('uploadAssistantFile', () => {
  it('stores privately under assistant/{accountId}/{uuid}/..., files the row, returns the contract shape', async () => {
    const r = await uploadAssistantFile(SITE, form(pdf()))
    expect(r).toEqual({ status: 'ok', upload: { id: 'up-1', name: 'Tarifas.pdf', mime: 'application/pdf', sizeBytes: expect.any(Number), kind: 'document' } })
    const [key, , opts] = vi.mocked(put).mock.calls[0]!
    expect(key).toMatch(/^assistant\/owner-1\/[0-9a-f-]{36}\/Tarifas\.pdf$/)
    expect(opts).toMatchObject({ access: 'private' })
    expect(createUpload).toHaveBeenCalledWith(expect.objectContaining({ accountId: OWNER, siteId: SITE, mime: 'application/pdf', purpose: 'document' }))
  })

  it('falls back to an unguessable public key when the store is not private', async () => {
    vi.mocked(put).mockRejectedValueOnce(new Error('store is public')).mockResolvedValueOnce({ url: 'https://b/y' } as never)
    expect((await uploadAssistantFile(SITE, form(pdf()))).status).toBe('ok')
    expect(vi.mocked(put).mock.calls[1]![2]).toMatchObject({ access: 'public' })
  })

  it('a non-owner is forbidden and nothing is read, stored or counted', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'intruder' } } as never)
    expect(await uploadAssistantFile(SITE, form(pdf()))).toEqual({ status: 'error', errors: ['forbidden', 'Not authorized'] })
    expect(put).not.toHaveBeenCalled()
    expect(rateLimitShared).not.toHaveBeenCalled()
  })

  it('a sudo uploads for a site they do not own; the row belongs to the site OWNER', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'admin' } } as never)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: true } as never)
    expect((await uploadAssistantFile(SITE, form(pdf()))).status).toBe('ok')
    expect(createUpload).toHaveBeenCalledWith(expect.objectContaining({ accountId: OWNER }))
    expect(vi.mocked(put).mock.calls[0]![0]).toContain(`assistant/${OWNER}/`)
  })

  it('unavailable when the kill switch is off; forbidden when the flag is off', async () => {
    delete process.env.PARTNER_ASSISTANT_ENABLED
    expect(await uploadAssistantFile(SITE, form(pdf()))).toEqual({ status: 'error', errors: ['unavailable'] })
    process.env.PARTNER_ASSISTANT_ENABLED = '1'
    vi.mocked(getFlagStates).mockResolvedValue({ assistant: { enabled: false } } as never)
    expect(await uploadAssistantFile(SITE, form(pdf()))).toEqual({ status: 'error', errors: ['forbidden'] })
  })

  it('unsupported_type by bytes: an HTML file labelled application/pdf, an empty file, no file', async () => {
    const fake = new File(['<html>not a pdf at all</html>'], 'x.pdf', { type: 'application/pdf' })
    expect(await uploadAssistantFile(SITE, form(fake))).toEqual({ status: 'error', errors: ['unsupported_type'] })
    expect(await uploadAssistantFile(SITE, form(new File([], 'e.pdf')))).toEqual({ status: 'error', errors: ['unsupported_type'] })
    expect(await uploadAssistantFile(SITE, new FormData())).toEqual({ status: 'error', errors: ['unsupported_type'] })
    expect(put).not.toHaveBeenCalled()
  })

  it('too_large above 20 MB, before the daily counter is touched', async () => {
    const big = new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'big.pdf')
    expect(await uploadAssistantFile(SITE, form(big))).toEqual({ status: 'error', errors: ['too_large'] })
    expect(rateLimitShared).not.toHaveBeenCalled()
  })

  it('rate_limited past the per-account daily cap, keyed by the owner account', async () => {
    vi.mocked(rateLimitShared).mockResolvedValue({ allowed: false, count: 31 })
    expect(await uploadAssistantFile(SITE, form(pdf()))).toEqual({ status: 'error', errors: ['rate_limited'] })
    expect(vi.mocked(rateLimitShared).mock.calls[0]![0]).toBe(`assistant:upload:${OWNER}`)
    expect(put).not.toHaveBeenCalled()
  })

  it('HEIC that the server cannot decode is unsupported_type, not a later model-turn failure', async () => {
    const heic = new File([new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0])], 'p.heic')
    expect(await uploadAssistantFile(SITE, form(heic))).toEqual({ status: 'error', errors: ['unsupported_type'] })
    expect(put).not.toHaveBeenCalled()
  })

  it('unavailable (and no row) when storage fails entirely', async () => {
    vi.mocked(put).mockRejectedValue(new Error('blob down'))
    expect(await uploadAssistantFile(SITE, form(pdf()))).toEqual({ status: 'error', errors: ['unavailable'] })
    expect(createUpload).not.toHaveBeenCalled()
  })
})
