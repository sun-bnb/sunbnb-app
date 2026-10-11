/**
 * POST /api/assistant/aerial/[uploadId]/extract (track 030 S7) -- auth matrix. Requirements: nothing
 * is extracted (or billed) unless the kill switch is on, the caller is signed in, the upload is
 * their own (or they are sudo), live, on a site they own whose account owns the upload, the flag is
 * on, the upload is an image and the site uses the map; every "not yours / gone" is the same 404.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn() }))
vi.mock('@repo/data/assistant', () => ({ getUploadForAccount: vi.fn() }))
vi.mock('@repo/data/flags', () => ({ getFlagStates: vi.fn() }))
vi.mock('@/lib/assistant/aerial/extract', () => ({ runAerialExtraction: vi.fn() }))

import { POST } from './route'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getUploadForAccount } from '@repo/data/assistant'
import { getFlagStates } from '@repo/data/flags'
import { runAerialExtraction } from '@/lib/assistant/aerial/extract'

const OWNER = 'owner-1'
const SITE = 'site-1'
const row = (over: Record<string, unknown> = {}) =>
  ({ id: 'up1', accountId: OWNER, siteId: SITE, url: 'https://blob/x', mime: 'image/jpeg', expiresAt: new Date(Date.now() + 3600_000), ...over }) as never
const site = (over: Record<string, unknown> = {}) => ({ id: SITE, userId: OWNER, layoutMode: 'geo', locationLat: '36.7', locationLng: '-4.4', ...over }) as never
const call = (id = 'up1') => POST(new Request(`http://localhost/api/assistant/aerial/${id}/extract`, { method: 'POST' }), { params: Promise.resolve({ uploadId: id }) })
const env = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.PARTNER_ASSISTANT_ENABLED = '1'
  process.env.ANTHROPIC_API_KEY = 'k'
  delete process.env.PARTNER_AI_DAILY_TURNS
  vi.mocked(auth).mockResolvedValue({ user: { id: OWNER } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as never)
  vi.mocked(prisma.site.findUnique).mockResolvedValue(site())
  vi.mocked(prisma.assistantUpload.findFirst).mockResolvedValue(null)
  vi.mocked(getUploadForAccount).mockResolvedValue(row())
  vi.mocked(getFlagStates).mockResolvedValue({ assistant: { enabled: true } } as never)
  vi.mocked(runAerialExtraction).mockResolvedValue({ status: 'done', usable: true, view: 'nadir', parcels: 2 })
})
afterEach(() => { process.env = { ...env } })

const expectNoExtraction = () => expect(runAerialExtraction).not.toHaveBeenCalled()

describe('POST /api/assistant/aerial/[uploadId]/extract', () => {
  it('503 when the kill switch is off', async () => {
    delete process.env.PARTNER_ASSISTANT_ENABLED
    expect((await call()).status).toBe(503)
    expect(auth).not.toHaveBeenCalled()
    expectNoExtraction()
  })

  it('401 without a session', async () => {
    vi.mocked(auth).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expectNoExtraction()
  })

  it("404 for another account's upload (lookup scoped to the caller)", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'intruder' } } as never)
    vi.mocked(getUploadForAccount).mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(getUploadForAccount).toHaveBeenCalledWith('up1', 'intruder')
    expectNoExtraction()
  })

  it('404 for an own upload filed on a site the caller does not own', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue(site({ id: 'site-2', userId: 'someone-else' }))
    vi.mocked(getUploadForAccount).mockResolvedValue(row({ siteId: 'site-2' }))
    expect((await call()).status).toBe(404)
    expectNoExtraction()
  })

  it('404 for a sudo reaching an upload whose account is not the site owner', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'admin' } } as never)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: true } as never)
    vi.mocked(getUploadForAccount).mockResolvedValue(null)
    vi.mocked(prisma.assistantUpload.findFirst).mockResolvedValue(row({ accountId: 'other-account' }))
    expect((await call()).status).toBe(404)
    expectNoExtraction()
  })

  it('404 for an expired or site-less upload, and for a malformed id', async () => {
    vi.mocked(getUploadForAccount).mockResolvedValue(row({ expiresAt: new Date(Date.now() - 1) }))
    expect((await call()).status).toBe(404)
    vi.mocked(getUploadForAccount).mockResolvedValue(row({ siteId: null }))
    expect((await call()).status).toBe(404)
    expect((await call('../etc')).status).toBe(404)
    expectNoExtraction()
  })

  it('403 when the assistant flag is off', async () => {
    vi.mocked(getFlagStates).mockResolvedValue({ assistant: { enabled: false } } as never)
    expect((await call()).status).toBe(403)
    expectNoExtraction()
  })

  it('415 for a non-image upload, 409 on a schematic site, 503 when the global budget is 0', async () => {
    vi.mocked(getUploadForAccount).mockResolvedValue(row({ mime: 'application/pdf' }))
    expect((await call()).status).toBe(415)
    vi.mocked(getUploadForAccount).mockResolvedValue(row())
    vi.mocked(prisma.site.findUnique).mockResolvedValue(site({ layoutMode: 'schematic' }))
    expect((await call()).status).toBe(409)
    vi.mocked(prisma.site.findUnique).mockResolvedValue(site())
    process.env.PARTNER_AI_DAILY_TURNS = '0'
    expect((await call()).status).toBe(503)
    expectNoExtraction()
  })

  it('owner: runs the extraction under the upload account, limits charged to the caller', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'done', usable: true, view: 'nadir', parcels: 2 })
    expect(runAerialExtraction).toHaveBeenCalledWith(expect.objectContaining({ uploadId: 'up1', accountId: OWNER, userId: OWNER, url: 'https://blob/x' }))
  })

  it('sudo on the owner\'s upload is allowed', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'admin' } } as never)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: true } as never)
    vi.mocked(getUploadForAccount).mockResolvedValue(null)
    vi.mocked(prisma.assistantUpload.findFirst).mockResolvedValue(row())
    expect((await call()).status).toBe(200)
    expect(runAerialExtraction).toHaveBeenCalledWith(expect.objectContaining({ accountId: OWNER, userId: 'admin' }))
  })

  it('429 when a daily limit refused the extraction', async () => {
    vi.mocked(runAerialExtraction).mockResolvedValue({ status: 'failed', error: 'aerial_limit' })
    const res = await call()
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ status: 'failed', error: 'aerial_limit' })
  })
})
