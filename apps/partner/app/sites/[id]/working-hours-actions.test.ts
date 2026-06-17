import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/auth-helpers', () => ({
  requireSiteOwner: vi.fn().mockResolvedValue({ session: null, error: 'Not authenticated' }),
}))

import { addWorkingHours, updateWorkingHours, deleteWorkingHours } from './working-hours-actions'
import { auth } from '@/app/auth'
import { requireSiteOwner } from '@/lib/auth-helpers'
import prisma from '@repo/data/PrismaCient'

const mockAuth = vi.mocked(auth)
const mockRequireSiteOwner = vi.mocked(requireSiteOwner)

const OWNER_ID = 'owner-1'
const OTHER_ID = 'other-1'
const SITE_ID = 'site-1'
const WH_ID = 'wh-1'

// The loadSiteWorkingHours helper called after mutations
const WH_LIST = [{ id: WH_ID, day: 1, openTime: new Date(), closeTime: new Date() }]

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  mockRequireSiteOwner.mockResolvedValue({ session: null, error: 'Not authenticated' })
})

function authorizeOwner() {
  const session = { user: { id: OWNER_ID } }
  mockAuth.mockResolvedValue(session as any)
  mockRequireSiteOwner.mockResolvedValue({ session, error: null })
}

// ─── addWorkingHours ────────────────────────────────────────────────────────

describe('addWorkingHours', () => {
  // ── Validation ──

  it('rejects day < 0', async () => {
    const res = await addWorkingHours(SITE_ID, { day: '-1', openTime: '09:00', closeTime: '17:00' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Day must be 0–7')
  })

  it('rejects day > 7', async () => {
    const res = await addWorkingHours(SITE_ID, { day: '8', openTime: '09:00', closeTime: '17:00' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Day must be 0–7')
  })

  it('rejects non-integer day (float string)', async () => {
    const res = await addWorkingHours(SITE_ID, { day: '1.5', openTime: '09:00', closeTime: '17:00' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Day must be 0–7')
  })

  it('rejects non-numeric day string', async () => {
    const res = await addWorkingHours(SITE_ID, { day: 'monday', openTime: '09:00', closeTime: '17:00' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Day must be 0–7')
  })

  it('accepts day 0 (boundary)', async () => {
    authorizeOwner()
    vi.mocked(prisma.siteWorkingHours.create).mockResolvedValue({} as any)
    vi.mocked(prisma.siteWorkingHours.findMany).mockResolvedValue(WH_LIST as any)
    const res = await addWorkingHours(SITE_ID, { day: '0', openTime: '09:00', closeTime: '17:00' })
    expect(res.status).toBe('ok')
  })

  it('accepts day 7 (boundary)', async () => {
    authorizeOwner()
    vi.mocked(prisma.siteWorkingHours.create).mockResolvedValue({} as any)
    vi.mocked(prisma.siteWorkingHours.findMany).mockResolvedValue(WH_LIST as any)
    const res = await addWorkingHours(SITE_ID, { day: '7', openTime: '09:00', closeTime: '17:00' })
    expect(res.status).toBe('ok')
  })

  it('rejects openTime not in HH:MM format (missing leading zero)', async () => {
    const res = await addWorkingHours(SITE_ID, { day: '1', openTime: '9:00', closeTime: '17:00' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Time must be in HH:MM format')
  })

  it('rejects closeTime not in HH:MM format (extra seconds)', async () => {
    const res = await addWorkingHours(SITE_ID, { day: '1', openTime: '09:00', closeTime: '17:00:00' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Time must be in HH:MM format')
  })

  it('rejects time as empty string', async () => {
    const res = await addWorkingHours(SITE_ID, { day: '1', openTime: '', closeTime: '17:00' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Time must be in HH:MM format')
  })

  // ── Auth ──

  it('rejects unauthenticated — validation passes, ownership fails', async () => {
    // day/time valid → falls through to requireSiteOwner → not authenticated
    const res = await addWorkingHours(SITE_ID, { day: '1', openTime: '09:00', closeTime: '17:00' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  // ── Happy path ──

  it('creates working hours and returns the updated list', async () => {
    authorizeOwner()
    vi.mocked(prisma.siteWorkingHours.create).mockResolvedValue({} as any)
    vi.mocked(prisma.siteWorkingHours.findMany).mockResolvedValue(WH_LIST as any)

    const res = await addWorkingHours(SITE_ID, { day: '3', openTime: '09:00', closeTime: '18:00' })

    expect(res.status).toBe('ok')
    expect('workingHours' in res && res.workingHours).toBeDefined()

    // createWorkingHours must store times as Date objects
    const createCall = vi.mocked(prisma.siteWorkingHours.create).mock.calls[0][0]
    expect(createCall.data.day).toBe(3)
    expect(createCall.data.openTime).toBeInstanceOf(Date)
    expect(createCall.data.closeTime).toBeInstanceOf(Date)
    // Dates constructed with a UTC time string — openTime should parse to 09:00 UTC
    expect((createCall.data.openTime as Date).getUTCHours()).toBe(9)
    expect((createCall.data.closeTime as Date).getUTCHours()).toBe(18)

    // loadSiteWorkingHours called for the site
    const findManyCall = vi.mocked(prisma.siteWorkingHours.findMany).mock.calls[0][0]
    expect(findManyCall.where.siteId).toBe(SITE_ID)
  })
})

// ─── updateWorkingHours ────────────────────────────────────────────────────

describe('updateWorkingHours', () => {
  // ── Validation ──

  it('rejects openTime not in HH:MM format', async () => {
    const res = await updateWorkingHours(WH_ID, { openTime: '9:00', closeTime: '17:00' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Time must be in HH:MM format')
  })

  it('rejects closeTime not in HH:MM format', async () => {
    const res = await updateWorkingHours(WH_ID, { openTime: '09:00', closeTime: 'noon' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Time must be in HH:MM format')
  })

  // ── Auth: manual auth() + site.userId check (NOT requireSiteOwner) ──

  it('rejects unauthenticated (no session)', async () => {
    // mockAuth returns null (beforeEach default)
    const res = await updateWorkingHours(WH_ID, { openTime: '09:00', closeTime: '17:00' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('rejects non-owner — session userId does not match wh.site.userId', async () => {
    // Authenticated as OTHER_ID, but record belongs to OWNER_ID
    mockAuth.mockResolvedValue({ user: { id: OTHER_ID } } as any)
    vi.mocked(prisma.siteWorkingHours.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      site: { userId: OWNER_ID },
    } as any)

    const res = await updateWorkingHours(WH_ID, { openTime: '09:00', closeTime: '17:00' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('rejects when working-hours record not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.siteWorkingHours.findUnique).mockResolvedValue(null)

    const res = await updateWorkingHours(WH_ID, { openTime: '09:00', closeTime: '17:00' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  // ── Happy path ──

  it('updates working hours and returns updated list for site owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.siteWorkingHours.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      site: { userId: OWNER_ID },
    } as any)
    vi.mocked(prisma.siteWorkingHours.update).mockResolvedValue({} as any)
    vi.mocked(prisma.siteWorkingHours.findMany).mockResolvedValue(WH_LIST as any)

    const res = await updateWorkingHours(WH_ID, { openTime: '10:00', closeTime: '20:00' })

    expect(res.status).toBe('ok')
    expect('workingHours' in res && res.workingHours).toBeDefined()

    const updateCall = vi.mocked(prisma.siteWorkingHours.update).mock.calls[0][0]
    expect(updateCall.where.id).toBe(WH_ID)
    expect(updateCall.data.openTime).toBeInstanceOf(Date)
    expect(updateCall.data.closeTime).toBeInstanceOf(Date)
    expect((updateCall.data.openTime as Date).getUTCHours()).toBe(10)
    expect((updateCall.data.closeTime as Date).getUTCHours()).toBe(20)
  })
})

// ─── deleteWorkingHours ────────────────────────────────────────────────────

describe('deleteWorkingHours', () => {
  // ── Auth: manual auth() + site.userId check (NOT requireSiteOwner) ──

  it('rejects unauthenticated (no session)', async () => {
    const res = await deleteWorkingHours(WH_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
  })

  it('rejects non-owner — session userId does not match wh.site.userId', async () => {
    mockAuth.mockResolvedValue({ user: { id: OTHER_ID } } as any)
    vi.mocked(prisma.siteWorkingHours.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      site: { userId: OWNER_ID },
    } as any)

    const res = await deleteWorkingHours(WH_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  it('rejects when working-hours record not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.siteWorkingHours.findUnique).mockResolvedValue(null)

    const res = await deleteWorkingHours(WH_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
  })

  // ── Happy path ──

  it('deletes working hours and returns updated list for site owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.siteWorkingHours.findUnique).mockResolvedValue({
      siteId: SITE_ID,
      site: { userId: OWNER_ID },
    } as any)
    vi.mocked(prisma.siteWorkingHours.delete).mockResolvedValue({} as any)
    vi.mocked(prisma.siteWorkingHours.findMany).mockResolvedValue([] as any)

    const res = await deleteWorkingHours(WH_ID)

    expect(res.status).toBe('ok')
    const deleteCall = vi.mocked(prisma.siteWorkingHours.delete).mock.calls[0][0]
    expect(deleteCall.where.id).toBe(WH_ID)
    // returns remaining working hours (empty after delete)
    expect('workingHours' in res && res.workingHours).toEqual([])
  })
})
