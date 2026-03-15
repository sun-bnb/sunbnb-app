import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import {
  previewSettlementAction,
  generateSettlementAction,
  closeSettlementAction,
  approveSettlementAction,
  markSettlementPaidAction,
  revertSettlementAction,
} from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import {
  previewSettlement,
  generateSettlement,
  closeSettlement,
  approveSettlement,
  markSettlementPaid,
  revertSettlement,
} from '@repo/data/settlement'

const mockAuth = vi.mocked(auth)

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

function authenticateAsSudo() {
  mockAuth.mockResolvedValue({ user: { id: 'admin-1' } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: true } as any)
}

// ─── Auth guard ──────────────────────────────────────────────────────────────

describe('settlements requireSudo', () => {
  it('throws when not authenticated', async () => {
    // NOTE: settlements actions catch the throw and return { status: 'error', errors }
    // ... EXCEPT requireSudo throws BEFORE the try/catch in some actions
    // Let's check: previewSettlementAction calls requireSudo() BEFORE the try block
    // so the throw propagates unhandled!
    await expect(previewSettlementAction({
      accountId: 'a', siteId: 's', periodStart: '2025-01-01', periodEnd: '2025-02-01',
    })).rejects.toThrow('Not authenticated')
  })

  // BUG: requireSudo error messages should be consistent across all admin actions
  // settlements throws 'Unauthorized — sudo required', users throws 'sudo required'
  it('throws consistent "sudo required" error message', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)

    await expect(previewSettlementAction({
      accountId: 'a', siteId: 's', periodStart: '2025-01-01', periodEnd: '2025-02-01',
    })).rejects.toThrow('sudo required')
    // Should match the same message used across all admin actions
  })
})

// ─── previewSettlementAction ─────────────────────────────────────────────────

describe('previewSettlementAction', () => {
  it('validates all required fields', async () => {
    authenticateAsSudo()
    const res = await previewSettlementAction({
      accountId: '', siteId: '', periodStart: '', periodEnd: '',
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Partner account is required')
    expect(res.errors).toContain('Site is required')
    expect(res.errors).toContain('Period start is required')
    expect(res.errors).toContain('Period end is required')
  })

  it('validates invalid date formats', async () => {
    authenticateAsSudo()
    const res = await previewSettlementAction({
      accountId: 'a', siteId: 's', periodStart: 'not-a-date', periodEnd: 'also-not',
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid period start date')
    expect(res.errors).toContain('Invalid period end date')
  })

  it('validates period start must be before period end', async () => {
    authenticateAsSudo()
    const res = await previewSettlementAction({
      accountId: 'a', siteId: 's', periodStart: '2025-02-01', periodEnd: '2025-01-01',
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Period start must be before period end')
  })

  // BUG PROBE: same start and end date is rejected (periodStart >= periodEnd)
  // but a zero-length period makes no business sense anyway, so this is correct
  it('rejects same start and end date', async () => {
    authenticateAsSudo()
    const res = await previewSettlementAction({
      accountId: 'a', siteId: 's', periodStart: '2025-01-01', periodEnd: '2025-01-01',
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Period start must be before period end')
  })

  it('returns preview data on success', async () => {
    authenticateAsSudo()
    vi.mocked(previewSettlement).mockResolvedValue({
      invoiceCount: 3,
      grossRevenue: 1000,
      totalTax: 240,
      commission: 100,
      netPayout: 660,
      invoices: [
        { id: 'inv-1', invoicedAt: new Date('2025-01-15'), totalAmount: 500, totalTax: 120, description: 'Reservation', type: 'reservation' },
      ],
    })

    const res = await previewSettlementAction({
      accountId: 'a', siteId: 's', periodStart: '2025-01-01', periodEnd: '2025-02-01',
    })
    expect(res.status).toBe('ok')
    expect(res.preview?.invoiceCount).toBe(3)
    expect(res.preview?.invoices[0].invoicedAt).toBe('2025-01-15T00:00:00.000Z')
  })

  it('returns error when no invoices found', async () => {
    authenticateAsSudo()
    vi.mocked(previewSettlement).mockResolvedValue(null)

    const res = await previewSettlementAction({
      accountId: 'a', siteId: 's', periodStart: '2025-01-01', periodEnd: '2025-02-01',
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('No unsettled invoices found for the selected period')
  })

  it('catches downstream errors', async () => {
    authenticateAsSudo()
    vi.mocked(previewSettlement).mockRejectedValue(new Error('DB down'))

    const res = await previewSettlementAction({
      accountId: 'a', siteId: 's', periodStart: '2025-01-01', periodEnd: '2025-02-01',
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('DB down')
  })
})

// ─── generateSettlementAction ────────────────────────────────────────────────

describe('generateSettlementAction', () => {
  it('generates settlement and returns id', async () => {
    authenticateAsSudo()
    vi.mocked(generateSettlement).mockResolvedValue({ id: 'set-1', invoiceCount: 5 })

    const res = await generateSettlementAction({
      accountId: 'a', siteId: 's', periodStart: '2025-01-01', periodEnd: '2025-02-01',
    })
    expect(res.status).toBe('ok')
    expect(res.settlementId).toBe('set-1')
    expect(res.invoiceCount).toBe(5)
  })

  it('has same validation as preview', async () => {
    authenticateAsSudo()
    const res = await generateSettlementAction({
      accountId: '', siteId: '', periodStart: '', periodEnd: '',
    })
    expect(res.status).toBe('error')
    expect(res.errors!.length).toBeGreaterThanOrEqual(4)
  })
})

// ─── Transition actions ──────────────────────────────────────────────────────

describe('closeSettlementAction', () => {
  it('closes settlement', async () => {
    authenticateAsSudo()
    vi.mocked(closeSettlement).mockResolvedValue(undefined as any)
    const res = await closeSettlementAction('set-1')
    expect(res.status).toBe('ok')
    expect(vi.mocked(closeSettlement)).toHaveBeenCalledWith('set-1')
  })

  it('returns error on failure', async () => {
    authenticateAsSudo()
    vi.mocked(closeSettlement).mockRejectedValue(new Error('Invalid transition'))
    const res = await closeSettlementAction('set-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Invalid transition')
  })
})

describe('approveSettlementAction', () => {
  it('approves settlement', async () => {
    authenticateAsSudo()
    vi.mocked(approveSettlement).mockResolvedValue(undefined as any)
    const res = await approveSettlementAction('set-1')
    expect(res.status).toBe('ok')
  })
})

describe('markSettlementPaidAction', () => {
  it('requires bank reference', async () => {
    authenticateAsSudo()
    const res = await markSettlementPaidAction({
      settlementId: 'set-1', bankReference: '', notes: '',
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Bank reference is required')
  })

  it('requires bank reference — whitespace only', async () => {
    authenticateAsSudo()
    const res = await markSettlementPaidAction({
      settlementId: 'set-1', bankReference: '   ', notes: '',
    })
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Bank reference is required')
  })

  it('marks paid with valid reference', async () => {
    authenticateAsSudo()
    vi.mocked(markSettlementPaid).mockResolvedValue(undefined as any)
    const res = await markSettlementPaidAction({
      settlementId: 'set-1', bankReference: 'REF-123', notes: 'Done',
    })
    expect(res.status).toBe('ok')
    expect(vi.mocked(markSettlementPaid)).toHaveBeenCalledWith('set-1', 'REF-123', 'Done')
  })
})

describe('revertSettlementAction', () => {
  it('reverts and returns deleted flag', async () => {
    authenticateAsSudo()
    vi.mocked(revertSettlement).mockResolvedValue({ deleted: true })
    const res = await revertSettlementAction('set-1')
    expect(res.status).toBe('ok')
    expect(res.deleted).toBe(true)
  })

  it('returns error on invalid revert', async () => {
    authenticateAsSudo()
    vi.mocked(revertSettlement).mockRejectedValue(new Error('Cannot revert PAID settlement'))
    const res = await revertSettlementAction('set-1')
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Cannot revert PAID settlement')
  })
})
