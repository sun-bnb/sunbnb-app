import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import {
  saveBusinessEntity,
  getSettings,
  saveSettings,
  deleteSettings,
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

// ─── saveBusinessEntity ──────────────────────────────────────────────────────

describe('saveBusinessEntity', () => {
  it('requires company name', async () => {
    authenticateAsSudo()
    const res = await saveBusinessEntity({
      companyName: '', companyAddress: 'addr', businessId: 'b',
      vatId: 'v', contactEmail: 'e', contactPhone: 'p',
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Company name is required')
  })

  // BUG: Only companyName is validated — contactEmail should at minimum be required
  it('requires contactEmail', async () => {
    authenticateAsSudo()
    const res = await saveBusinessEntity({
      companyName: 'Test Co', companyAddress: 'addr', businessId: 'b',
      vatId: 'v', contactEmail: '', contactPhone: 'p',
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Contact email is required')
  })

  it('creates settings when none exist', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.settings.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.settings.create).mockResolvedValue({} as any)

    const res = await saveBusinessEntity({
      companyName: 'Sunbnb Oy', companyAddress: 'Helsinki', businessId: '123',
      vatId: 'FI123', contactEmail: 'admin@sunbnb.app', contactPhone: '+358',
    })
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.settings.create)).toHaveBeenCalledTimes(1)
  })

  it('updates existing settings', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.settings.findFirst).mockResolvedValue({ id: 'set-1' } as any)
    vi.mocked(prisma.settings.update).mockResolvedValue({} as any)

    const res = await saveBusinessEntity({
      companyName: 'Updated Co', companyAddress: 'addr', businessId: 'b',
      vatId: 'v', contactEmail: 'e@e.com', contactPhone: '+1',
    })
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.settings.update)).toHaveBeenCalledWith({
      where: { id: 'set-1' },
      data: expect.objectContaining({ companyName: 'Updated Co' }),
    })
  })
})

// ─── saveSettings ────────────────────────────────────────────────────────────

describe('saveSettings', () => {
  it('validates required fields', async () => {
    authenticateAsSudo()
    const res = await saveSettings({ country: '', currency: '', vat: '' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Country is required')
    expect(res.errors).toContain('Currency is required')
    // Empty vat string is valid (treated as null)
    expect(res.errors).not.toContain('Tax rate must be a number')
  })

  it('validates VAT is a number', async () => {
    authenticateAsSudo()
    const res = await saveSettings({ country: 'FI', currency: 'EUR', vat: 'abc' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Tax rate must be a number')
  })

  it('validates VAT range 0-100', async () => {
    authenticateAsSudo()
    const res = await saveSettings({ country: 'FI', currency: 'EUR', vat: '101' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Tax rate must be 0–100')
  })

  it('rejects negative VAT', async () => {
    authenticateAsSudo()
    const res = await saveSettings({ country: 'FI', currency: 'EUR', vat: '-1' })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Tax rate must be 0–100')
  })

  it('normalizes country and currency to uppercase', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.settings.findMany).mockResolvedValue([])
    vi.mocked(prisma.settings.create).mockResolvedValue({
      id: 's-1', country: 'FI', vat: 24, currency: 'EUR',
    } as any)

    const res = await saveSettings({ country: '  fi  ', currency: '  eur  ', vat: '24' })
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.settings.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { country: 'FI', currency: 'EUR', vat: 24 },
      })
    )
  })

  it('allows null VAT (empty string)', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.settings.findMany).mockResolvedValue([])
    vi.mocked(prisma.settings.create).mockResolvedValue({
      id: 's-1', country: 'FI', vat: null, currency: 'EUR',
    } as any)

    const res = await saveSettings({ country: 'FI', currency: 'EUR', vat: '' })
    expect(res.status).toBe('ok')
    expect(vi.mocked(prisma.settings.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { country: 'FI', currency: 'EUR', vat: null },
      })
    )
  })

  it('updates existing settings', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.settings.update).mockResolvedValue({
      id: 's-1', country: 'ES', vat: 21, currency: 'EUR',
    } as any)

    const res = await saveSettings({ id: 's-1', country: 'ES', currency: 'EUR', vat: '21' })
    expect(res.status).toBe('ok')
    expect(res.settings?.country).toBe('ES')
  })

  // BUG PROBE: VAT of 0 should be valid (tax-free zone) — let's verify
  it('accepts VAT of 0', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.settings.findMany).mockResolvedValue([])
    vi.mocked(prisma.settings.create).mockResolvedValue({
      id: 's-1', country: 'AE', vat: 0, currency: 'AED',
    } as any)

    const res = await saveSettings({ country: 'AE', currency: 'AED', vat: '0' })
    expect(res.status).toBe('ok')
  })

  // BUG: No duplicate country check — should prevent multiple settings for same country
  it('rejects duplicate country entry', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.settings.findMany).mockResolvedValue([
      { id: 's-1', country: 'FI', vat: 24, currency: 'EUR' },
    ] as any)

    const res = await saveSettings({ country: 'FI', currency: 'EUR', vat: '25.5' })
    expect(res.status).toBe('error')
    expect(res.errors![0]).toContain('already exists')
  })
})

// ─── deleteSettings ──────────────────────────────────────────────────────────

describe('deleteSettings', () => {
  it('prevents deletion when service fees reference it', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.serviceFee.count).mockResolvedValue(3)

    const res = await deleteSettings('s-1')
    expect(res.status).toBe('error')
    expect(res.errors![0]).toContain('3 service fee(s) reference this settings entry')
  })

  it('deletes when no fees reference it', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.serviceFee.count).mockResolvedValue(0)
    vi.mocked(prisma.settings.delete).mockResolvedValue({} as any)

    const res = await deleteSettings('s-1')
    expect(res.status).toBe('ok')
  })
})

// ─── getSettings ─────────────────────────────────────────────────────────────

describe('getSettings', () => {
  it('returns settings ordered by country', async () => {
    authenticateAsSudo()
    vi.mocked(prisma.settings.findMany).mockResolvedValue([
      { id: 's-1', country: 'ES', vat: 21, currency: 'EUR' },
      { id: 's-2', country: 'FI', vat: 24, currency: 'EUR' },
    ] as any)

    const res = await getSettings()
    expect(res).toHaveLength(2)
    expect(vi.mocked(prisma.settings.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { country: 'asc' } })
    )
  })
})
