import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// `@repo/data/viva` has no vitest.config.ts alias (it doesn't import prisma —
// server-only fetch, like `@/app/api/_lib/mollie`), so mock it outright.
vi.mock('@repo/data/viva', () => ({
  getVivaAccountsClient: vi.fn(),
}))

import { connectViva, refreshVivaStatus, disconnectViva } from './actions'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getVivaAccountsClient } from '@repo/data/viva'
import { revalidatePath } from 'next/cache'

const mockAuth = vi.mocked(auth)
const mockGetVivaAccountsClient = vi.mocked(getVivaAccountsClient)

const OWNER_ID = 'owner-1'
const OTHER_ID = 'other-partner'
const ACCOUNT_ID = 'stub_acct_1'

const mockClient = {
  createConnectedAccount: vi.fn(),
  getConnectedAccount: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
  mockGetVivaAccountsClient.mockReturnValue(mockClient as any)
  process.env.NEXT_PUBLIC_APP_URL = 'https://local.sunbnb.app:3001'
})

// ─── connectViva ─────────────────────────────────────────────────────────────

describe('connectViva', () => {
  it('returns error when not authenticated', async () => {
    const result = await connectViva()
    expect(result).toEqual({ status: 'error', message: 'Not authenticated' })
    expect(mockClient.createConnectedAccount).not.toHaveBeenCalled()
  })

  it('returns error when NEXT_PUBLIC_APP_URL is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    delete process.env.NEXT_PUBLIC_APP_URL

    const result = await connectViva()

    expect(result.status).toBe('error')
    expect(mockClient.createConnectedAccount).not.toHaveBeenCalled()
  })

  it('returns error when no partner account exists', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue(null)

    const result = await connectViva()

    expect(result).toEqual({ status: 'error', message: 'No partner account found' })
  })

  it('creates a connected account and persists it when none exists yet', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({
      email: 'partner@example.com',
      vivaAccountId: null,
    } as any)
    mockClient.createConnectedAccount.mockResolvedValue({
      accountId: ACCOUNT_ID,
      invitation: { email: 'partner@example.com', redirectUrl: 'https://viva.example/onboard/1', created: '2026-08-30' },
    })
    vi.mocked(prisma.partnerAccount.update).mockResolvedValue({} as any)

    const result = await connectViva()

    expect(result).toEqual({ status: 'ok', redirectUrl: 'https://viva.example/onboard/1', alreadyConnected: false })
    expect(mockClient.createConnectedAccount).toHaveBeenCalledWith({
      email: 'partner@example.com',
      returnUrl: 'https://local.sunbnb.app:3001/account/viva?connected=1',
      branding: { partnerName: 'Sunbnb', logoUrl: 'https://local.sunbnb.app:3001/logo-lila.png' },
    })
    expect(prisma.partnerAccount.update).toHaveBeenCalledWith({
      where: { userId: OWNER_ID },
      data: expect.objectContaining({
        vivaAccountId: ACCOUNT_ID,
        vivaVerificationStatus: 'pending',
      }),
    })
    expect(revalidatePath).toHaveBeenCalledWith('/account/viva')
  })

  /**
   * BUG-REVEALING: idempotency. A partner who already has a `vivaAccountId`
   * must NEVER hit createConnectedAccount again — that mints a brand-new
   * account at Viva every time and orphans the first one.
   */
  it('is idempotent — does not re-create when vivaAccountId already set, refreshes instead', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({
      email: 'partner@example.com',
      vivaAccountId: ACCOUNT_ID,
    } as any)
    mockClient.getConnectedAccount.mockResolvedValue({
      accountId: ACCOUNT_ID,
      verificationStatus: 'pending',
      merchantId: undefined,
      raw: {},
    })
    vi.mocked(prisma.partnerAccount.update).mockResolvedValue({} as any)

    const result = await connectViva()

    expect(result).toEqual({ status: 'ok', redirectUrl: null, alreadyConnected: true })
    expect(mockClient.createConnectedAccount).not.toHaveBeenCalled()
    expect(mockClient.getConnectedAccount).toHaveBeenCalledWith(ACCOUNT_ID)
  })

  it('scopes the create to session.user.id — cannot connect another partner', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({
      email: 'partner@example.com',
      vivaAccountId: null,
    } as any)
    mockClient.createConnectedAccount.mockResolvedValue({
      accountId: ACCOUNT_ID,
      invitation: { email: 'partner@example.com', redirectUrl: 'https://viva.example/onboard/1', created: '2026-08-30' },
    })
    vi.mocked(prisma.partnerAccount.update).mockResolvedValue({} as any)

    await connectViva()

    const [call] = vi.mocked(prisma.partnerAccount.findUnique).mock.calls
    expect(call[0].where).toEqual({ userId: OWNER_ID })
    expect(call[0].where.userId).not.toBe(OTHER_ID)
  })

  it('returns error (not a throw) when Viva create fails', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({
      email: 'partner@example.com',
      vivaAccountId: null,
    } as any)
    mockClient.createConnectedAccount.mockRejectedValue(new Error('viva down'))

    const result = await connectViva()

    expect(result.status).toBe('error')
    expect(prisma.partnerAccount.update).not.toHaveBeenCalled()
  })
})

// ─── refreshVivaStatus ────────────────────────────────────────────────────────

describe('refreshVivaStatus', () => {
  it('returns error when not authenticated', async () => {
    const result = await refreshVivaStatus()
    expect(result).toEqual({ status: 'error', message: 'Not authenticated' })
    expect(mockClient.getConnectedAccount).not.toHaveBeenCalled()
  })

  it('returns error when no Viva account connected yet', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({ vivaAccountId: null } as any)

    const result = await refreshVivaStatus()

    expect(result).toEqual({ status: 'error', message: 'No Viva account connected yet' })
  })

  it('writes merchantId once Viva reports the account verified', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({ vivaAccountId: ACCOUNT_ID } as any)
    mockClient.getConnectedAccount.mockResolvedValue({
      accountId: ACCOUNT_ID,
      verificationStatus: 'verified',
      merchantId: 'merchant-xyz',
      raw: {},
    })
    vi.mocked(prisma.partnerAccount.update).mockResolvedValue({} as any)

    const result = await refreshVivaStatus()

    expect(result).toEqual({ status: 'ok', verificationStatus: 'verified', merchantId: 'merchant-xyz' })
    expect(prisma.partnerAccount.update).toHaveBeenCalledWith({
      where: { userId: OWNER_ID },
      data: { vivaVerificationStatus: 'verified', vivaMerchantId: 'merchant-xyz' },
    })
  })

  it('writes null merchantId while still pending', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({ vivaAccountId: ACCOUNT_ID } as any)
    mockClient.getConnectedAccount.mockResolvedValue({
      accountId: ACCOUNT_ID,
      verificationStatus: 'pending',
      merchantId: undefined,
      raw: {},
    })
    vi.mocked(prisma.partnerAccount.update).mockResolvedValue({} as any)

    const result = await refreshVivaStatus()

    expect(result).toEqual({ status: 'ok', verificationStatus: 'pending', merchantId: null })
  })

  it('revalidates /account/viva on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({ vivaAccountId: ACCOUNT_ID } as any)
    mockClient.getConnectedAccount.mockResolvedValue({
      accountId: ACCOUNT_ID,
      verificationStatus: 'pending',
      raw: {},
    })
    vi.mocked(prisma.partnerAccount.update).mockResolvedValue({} as any)

    await refreshVivaStatus()

    expect(revalidatePath).toHaveBeenCalledWith('/account/viva')
  })

  it('returns error (not a throw) when the Viva lookup fails', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({ vivaAccountId: ACCOUNT_ID } as any)
    mockClient.getConnectedAccount.mockRejectedValue(new Error('network error'))

    const result = await refreshVivaStatus()

    expect(result.status).toBe('error')
    expect(prisma.partnerAccount.update).not.toHaveBeenCalled()
  })
})

// ─── disconnectViva ───────────────────────────────────────────────────────────

describe('disconnectViva', () => {
  it('returns error when not authenticated', async () => {
    const result = await disconnectViva()
    expect(result).toEqual({ status: 'error', message: 'Not authenticated' })
    expect(prisma.partnerAccount.update).not.toHaveBeenCalled()
  })

  it('clears all five viva* fields, scoped to session.user.id', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.partnerAccount.update).mockResolvedValue({} as any)

    const result = await disconnectViva()

    expect(result).toEqual({ status: 'ok' })
    expect(prisma.partnerAccount.update).toHaveBeenCalledWith({
      where: { userId: OWNER_ID },
      data: {
        vivaAccountId: null,
        vivaMerchantId: null,
        vivaVerificationStatus: null,
        vivaSourceCode: null,
        vivaConnectedAt: null,
      },
    })
  })

  it('does not touch VivaTerminal rows', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.partnerAccount.update).mockResolvedValue({} as any)

    await disconnectViva()

    expect(prisma.vivaTerminal.delete).not.toHaveBeenCalled()
    expect(prisma.vivaTerminal.upsert).not.toHaveBeenCalled()
  })

  it('revalidates /account/viva on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.partnerAccount.update).mockResolvedValue({} as any)

    await disconnectViva()

    expect(revalidatePath).toHaveBeenCalledWith('/account/viva')
  })
})
