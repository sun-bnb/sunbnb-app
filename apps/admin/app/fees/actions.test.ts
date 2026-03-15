import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import {
  saveServiceFee,
  searchSites,
  searchAccounts,
  getFeesBySite,
  getFeesByAccount,
  getPlatformFees,
  deleteServiceFee,
  saveServiceCode,
  deleteServiceCode,
} from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

const mockAuth = vi.mocked(auth)

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

function authenticateAsSudo() {
  mockAuth.mockResolvedValue({ user: { id: 'admin-1' } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: true } as any)
}

// ─── saveServiceFee ──────────────────────────────────────────────────────────

describe('saveServiceFee', () => {
  it('validates required fields', async () => {
    authenticateAsSudo()
    const res = await saveServiceFee({
      settingsId: '', chargeType: '', serviceCode: '',
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Settings is required')
    expect(res.errors).toContain('Charge type is required')
    expect(res.errors).toContain('Service code is required')
  })

  it('requires feeAmount for fixed charge type', async () => {
    authenticateAsSudo()
    const res = await saveServiceFee({
      settingsId: 's', chargeType: 'fixed', serviceCode: 'sunbed',
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Fee amount is required for fixed charge type')
  })

  it('requires percentage for percentage charge type', async () => {
    authenticateAsSudo()
    const res = await saveServiceFee({
      settingsId: 's', chargeType: 'percentage', serviceCode: 'sunbed',
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Percentage is required for percentage charge type')
  })

  it('creates new fee', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.serviceFee.create).mockResolvedValue({} as any)

    const res = await saveServiceFee({
      settingsId: 's-1', chargeType: 'fixed', serviceCode: 'sunbed', feeAmount: 5,
    })
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.serviceFee.create)).toHaveBeenCalledTimes(1)
  })

  it('updates existing fee', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.serviceFee.update).mockResolvedValue({} as any)

    const res = await saveServiceFee({
      id: 'fee-1', settingsId: 's-1', chargeType: 'percentage', serviceCode: 'order', percentage: 10,
    })
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.serviceFee.update)).toHaveBeenCalledWith({
      where: { id: 'fee-1' },
      data: expect.objectContaining({ chargeType: 'percentage', percentage: 10 }),
    })
  })

  // BUG: No mutual exclusivity check — setting both feeAmount and percentage should be rejected
  it('rejects setting both feeAmount and percentage simultaneously', async () => {
    authenticateAsSudo()
    const res = await saveServiceFee({
      settingsId: 's-1', chargeType: 'fixed', serviceCode: 'sunbed',
      feeAmount: 5, percentage: 10,
    })
    expect(res.status).toBe('error')
  })

  // BUG: No bounds validation on fee values
  it('rejects negative fee amount', async () => {
    authenticateAsSudo()
    const res = await saveServiceFee({
      settingsId: 's-1', chargeType: 'fixed', serviceCode: 'sunbed', feeAmount: -10,
    })
    expect(res.status).toBe('error')
  })

  it('rejects percentage over 100', async () => {
    authenticateAsSudo()
    const res = await saveServiceFee({
      settingsId: 's-1', chargeType: 'percentage', serviceCode: 'sunbed', percentage: 150,
    })
    expect(res.status).toBe('error')
  })

  // BUG: chargeType is not validated against known values
  it('rejects unknown chargeType', async () => {
    authenticateAsSudo()
    const res = await saveServiceFee({
      settingsId: 's-1', chargeType: 'bogus', serviceCode: 'sunbed',
    })
    expect(res.status).toBe('error')
  })
})

// ─── searchSites / searchAccounts ────────────────────────────────────────────

describe('searchSites', () => {
  it('returns empty for blank query', async () => {
    authenticateAsSudo()
    const res = await searchSites('')
    expect(res).toEqual([])
  })

  it('searches by name and id', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.site.findMany).mockResolvedValue([{ id: 's-1', name: 'Beach' }] as any)
    const res = await searchSites('beach')
    expect(res).toHaveLength(1)
  })
})

describe('searchAccounts', () => {
  it('returns empty for blank query', async () => {
    authenticateAsSudo()
    const res = await searchAccounts('')
    expect(res).toEqual([])
  })

  it('searches partner accounts', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.partnerAccount.findMany).mockResolvedValue([
      { userId: 'u-1', company: 'Beach Co', firstName: 'John', lastName: 'Doe' },
    ] as any)
    const res = await searchAccounts('Beach')
    expect(res).toHaveLength(1)
  })
})

// ─── Fee queries ─────────────────────────────────────────────────────────────

describe('getFeesBySite', () => {
  it('returns fees for a site', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.serviceFee.findMany).mockResolvedValue([{ id: 'f-1' }] as any)
    const res = await getFeesBySite('site-1')
    expect(res).toHaveLength(1)
    expect(vi.mocked(prisma.serviceFee.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { siteId: 'site-1' } })
    )
  })
})

describe('getPlatformFees', () => {
  it('queries where siteId and accountId are null', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.serviceFee.findMany).mockResolvedValue([])
    await getPlatformFees()
    expect(vi.mocked(prisma.serviceFee.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { siteId: null, accountId: null } })
    )
  })
})

// ─── deleteServiceFee ────────────────────────────────────────────────────────

describe('deleteServiceFee', () => {
  it('deletes fee', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.serviceFee.delete).mockResolvedValue({} as any)
    const res = await deleteServiceFee('fee-1')
    expect(res.status).toBe('ok')
  })
})

// ─── saveServiceCode ─────────────────────────────────────────────────────────

describe('saveServiceCode', () => {
  it('validates code required', async () => {
    authenticateAsSudo()
    const res = await saveServiceCode({ code: '' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Code is required')
  })

  it('normalizes code to lowercase', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.serviceCode.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.serviceCode.create).mockResolvedValue({ id: 'sc-1' } as any)

    const res = await saveServiceCode({ code: '  SUNBED  ' })
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.serviceCode.create)).toHaveBeenCalledWith({
      data: { code: 'sunbed', description: null },
    })
  })

  it('rejects duplicate code', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.serviceCode.findUnique).mockResolvedValue({ id: 'existing' } as any)

    const res = await saveServiceCode({ code: 'sunbed' })
    expect(res.status).toBe('error')
    expect(res.errors![0]).toContain('already exists')
  })

  it('updates existing code', async () => {
    authenticateAsSudo()
    // findUnique returns the same record (same id) — not a collision
    vi.mocked(prisma.serviceCode.findUnique).mockResolvedValue({ id: 'sc-1', code: 'updated' } as any)
    vi.mocked(prisma.serviceCode.update).mockResolvedValue({} as any)

    const res = await saveServiceCode({ id: 'sc-1', code: 'updated', description: 'New desc' })
    expect(res.status).toBe('ok')
    expect(res.id).toBe('sc-1')
  })

  // BUG: When updating, duplicate check is skipped — should check for collisions
  it('rejects update that would collide with existing code', async () => {
    authenticateAsSudo()
    // Simulating that 'sunbed' already exists as a different code entry
    vi.mocked(prisma.serviceCode.findUnique).mockResolvedValue({ id: 'sc-other', code: 'sunbed' } as any)

    const res = await saveServiceCode({ id: 'sc-1', code: 'sunbed' })
    expect(res.status).toBe('error')
    expect(res.errors![0]).toContain('already exists')
  })
})

// ─── deleteServiceCode ───────────────────────────────────────────────────────

describe('deleteServiceCode', () => {
  it('deletes code when no fees reference it', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.serviceCode.findUnique).mockResolvedValue({ code: 'sunbed' } as any)
    vi.mocked(prisma.serviceFee.count).mockResolvedValue(0)
    vi.mocked(prisma.serviceCode.delete).mockResolvedValue({} as any)
    const res = await deleteServiceCode('sc-1')
    expect(res.status).toBe('ok')
  })

  // BUG: deleteServiceCode has no referential integrity check (unlike deleteSettings)
  // Should check for referencing service fees before allowing deletion
  it('prevents deletion when service fees reference this code', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.serviceCode.findUnique).mockResolvedValue({ code: 'sunbed' } as any)
    vi.mocked(prisma.serviceFee.count).mockResolvedValue(2)

    const res = await deleteServiceCode('sc-with-fees')
    expect(res.status).toBe('error')
    expect(res.errors![0]).toContain('service fee')
  })
})
