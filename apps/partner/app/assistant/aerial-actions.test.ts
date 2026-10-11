/**
 * saveUploadGeoref (track 030 S7). Requirements: only the owner of the upload's site (or a sudo)
 * saves; a foreign or other-site upload reads as Not authorized and writes nothing; the georef is
 * validated (shape, ranges, near the site) before it is stored, under the upload's own account.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn() }))
vi.mock('@repo/data/assistant', () => ({ getUploadForAccount: vi.fn(), setUploadGeoref: vi.fn() }))

import { saveUploadGeoref } from './aerial-actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getUploadForAccount, setUploadGeoref } from '@repo/data/assistant'

const OWNER = 'owner-1'
const row = (over: Record<string, unknown> = {}) =>
  ({ id: 'up1', accountId: OWNER, siteId: 'site-1', url: 'u', mime: 'image/jpeg', expiresAt: new Date(Date.now() + 3600_000), ...over }) as never
const G = { kind: 'similarity', anchorPx: { x: 1000, y: 750 }, anchor: { lat: 36.7001, lng: -4.4001 }, metersPerPx: 0.05, rotationDeg: 12 }
const env = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.PARTNER_ASSISTANT_ENABLED = '1'
  process.env.ANTHROPIC_API_KEY = 'k'
  vi.mocked(auth).mockResolvedValue({ user: { id: OWNER } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as never)
  vi.mocked(prisma.site.findUnique).mockResolvedValue({ id: 'site-1', userId: OWNER, layoutMode: 'geo', locationLat: '36.7', locationLng: '-4.4' } as never)
  vi.mocked(prisma.assistantUpload.findFirst).mockResolvedValue(null)
  vi.mocked(getUploadForAccount).mockResolvedValue(row())
  vi.mocked(setUploadGeoref).mockResolvedValue(true)
})
afterEach(() => { process.env = { ...env } })

describe('saveUploadGeoref', () => {
  it('saves a valid georef on the owner\'s upload, under the upload account', async () => {
    expect(await saveUploadGeoref('up1', G)).toEqual({ status: 'ok' })
    expect(setUploadGeoref).toHaveBeenCalledWith('up1', OWNER, G)
  })

  it('Not authenticated without a session', async () => {
    vi.mocked(auth).mockResolvedValue(null)
    expect(await saveUploadGeoref('up1', G)).toEqual({ status: 'error', errors: ['Not authenticated'] })
    expect(setUploadGeoref).not.toHaveBeenCalled()
  })

  it("Not authorized for another account's upload", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'intruder' } } as never)
    vi.mocked(getUploadForAccount).mockResolvedValue(null)
    expect(await saveUploadGeoref('up1', G)).toEqual({ status: 'error', errors: ['Not authorized'] })
    expect(setUploadGeoref).not.toHaveBeenCalled()
  })

  it('Not authorized for an own upload on a site the caller does not own', async () => {
    vi.mocked(getUploadForAccount).mockResolvedValue(row({ siteId: 'site-2' }))
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ id: 'site-2', userId: 'someone', layoutMode: 'geo', locationLat: '1', locationLng: '1' } as never)
    expect((await saveUploadGeoref('up1', G)).status).toBe('error')
    expect(setUploadGeoref).not.toHaveBeenCalled()
  })

  it('rejects an invalid georef or one far from the site, writing nothing', async () => {
    expect((await saveUploadGeoref('up1', { ...G, metersPerPx: -1 })).status).toBe('error')
    expect(await saveUploadGeoref('up1', { ...G, anchor: { lat: 40, lng: -4.4 } })).toEqual({ status: 'error', errors: ['The aligned photo is too far from the site location'] })
    expect(setUploadGeoref).not.toHaveBeenCalled()
  })
})
