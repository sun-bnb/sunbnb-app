import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import { createTestUser, createTestSite } from '@/app/test/fixtures'

// ---------------------------------------------------------------------------
// Mocks — only auth and next/cache. Everything else (including
// requireSiteOwner) uses the real implementation against the test DB.
// ---------------------------------------------------------------------------

let mockUserId: string | null = null

vi.mock('@/app/auth', () => ({
  auth: vi.fn(async () =>
    mockUserId ? { user: { id: mockUserId } } : null
  ),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Import actions AFTER mocks are declared
// ---------------------------------------------------------------------------

import {
  saveGeneral,
  deleteSite,
  setSiteStatus,
  setPaymentProvider,
} from './site-actions'

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await cleanDatabase()
})

beforeEach(async () => {
  await cleanDatabase()
  mockUserId = null
})

afterAll(async () => {
  await cleanDatabase()
  await disconnectDatabase()
})

// ---------------------------------------------------------------------------
// saveGeneral
// ---------------------------------------------------------------------------

describe('saveGeneral', () => {
  it('persists name, type, price, vat, and location to the database', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    mockUserId = user.id

    const result = await saveGeneral({
      id: site.id,
      name: 'Updated Beach',
      type: 'unpaid',
      price: '25.50',
      vat: '10',
      locationLat: '40.4168',
      locationLng: '-3.7038',
    })

    expect(result).toEqual({ status: 'ok' })

    const updated = await prisma.site.findUnique({ where: { id: site.id } })
    expect(updated!.name).toBe('Updated Beach')
    expect(updated!.type).toBe('unpaid')
    expect(Number(updated!.price)).toBe(25.5)
    expect(Number(updated!.vat)).toBe(10)
    expect(updated!.locationLat).toBe('40.4168')
    expect(updated!.locationLng).toBe('-3.7038')
  })

  it('rejects an invalid site type and leaves the DB unchanged', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { name: 'Original' })
    mockUserId = user.id

    const result = await saveGeneral({
      id: site.id,
      name: 'Should Not Save',
      type: 'bogus',
      price: '10',
      vat: '25',
      locationLat: '60.0',
      locationLng: '24.0',
    })

    expect(result.status).toBe('error')
    expect(result.errors).toContain('Invalid site type')

    const unchanged = await prisma.site.findUnique({ where: { id: site.id } })
    expect(unchanged!.name).toBe('Original')
  })

  it('rejects a non-numeric price and leaves the DB unchanged', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { name: 'Original' })
    mockUserId = user.id

    const result = await saveGeneral({
      id: site.id,
      name: 'Whatever',
      type: 'paid',
      price: 'abc',
      vat: '25',
      locationLat: '60.0',
      locationLng: '24.0',
    })

    expect(result.status).toBe('error')
    expect(result.errors).toContain('Invalid price')

    const unchanged = await prisma.site.findUnique({ where: { id: site.id } })
    expect(unchanged!.name).toBe('Original')
  })

  it('sets price to null for zero value', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { price: 50 })
    mockUserId = user.id

    const result = await saveGeneral({
      id: site.id,
      name: 'Beach',
      type: 'paid',
      price: '0',
      vat: '0',
      locationLat: '60.0',
      locationLng: '24.0',
    })

    expect(result).toEqual({ status: 'ok' })

    const updated = await prisma.site.findUnique({ where: { id: site.id } })
    expect(updated!.price).toBeNull()
    expect(updated!.vat).toBeNull()
  })

  it('rejects when user does not own the site', async () => {
    const owner = await createTestUser()
    const stranger = await createTestUser()
    const site = await createTestSite(owner.id, { name: 'Original' })
    mockUserId = stranger.id

    const result = await saveGeneral({
      id: site.id,
      name: 'Hacked',
      type: 'paid',
      price: '10',
      vat: '25',
      locationLat: '60.0',
      locationLng: '24.0',
    })

    expect(result.status).toBe('error')

    const unchanged = await prisma.site.findUnique({ where: { id: site.id } })
    expect(unchanged!.name).toBe('Original')
  })

  it('trims whitespace from the site name', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    mockUserId = user.id

    await saveGeneral({
      id: site.id,
      name: '  Trimmed Beach  ',
      type: 'paid',
      price: '10',
      vat: '25',
      locationLat: '60.0',
      locationLng: '24.0',
    })

    const updated = await prisma.site.findUnique({ where: { id: site.id } })
    expect(updated!.name).toBe('Trimmed Beach')
  })
})

// ---------------------------------------------------------------------------
// deleteSite
// ---------------------------------------------------------------------------

describe('deleteSite', () => {
  it('removes the site row from the database', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id)
    mockUserId = user.id

    const result = await deleteSite(site.id)
    expect(result).toEqual({ status: 'ok' })

    const gone = await prisma.site.findUnique({ where: { id: site.id } })
    expect(gone).toBeNull()
  })

  it('rejects delete for non-owner and keeps the site in the DB', async () => {
    const owner = await createTestUser()
    const stranger = await createTestUser()
    const site = await createTestSite(owner.id)
    mockUserId = stranger.id

    const result = await deleteSite(site.id)
    expect(result.status).toBe('error')

    const stillThere = await prisma.site.findUnique({ where: { id: site.id } })
    expect(stillThere).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// setSiteStatus
// ---------------------------------------------------------------------------

describe('setSiteStatus', () => {
  it('persists a valid status change to the database', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { status: 'hidden' })
    mockUserId = user.id

    const result = await setSiteStatus(site.id, 'active')
    expect(result).toEqual({ status: 'ok' })

    const updated = await prisma.site.findUnique({ where: { id: site.id } })
    expect(updated!.status).toBe('active')
  })

  it('rejects an invalid status and leaves the DB unchanged', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { status: 'hidden' })
    mockUserId = user.id

    const result = await setSiteStatus(site.id, 'bogus')
    expect(result.status).toBe('error')
    expect(result.errors).toContain('Invalid site status')

    const unchanged = await prisma.site.findUnique({ where: { id: site.id } })
    expect(unchanged!.status).toBe('hidden')
  })
})

// ---------------------------------------------------------------------------
// setPaymentProvider
// ---------------------------------------------------------------------------

describe('setPaymentProvider', () => {
  it('rejects stripe and leaves the provider unchanged (Mollie-only)', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { paymentProvider: 'mollie' })
    mockUserId = user.id

    const result = await setPaymentProvider(site.id, 'stripe')
    expect(result.status).toBe('error')

    const updated = await prisma.site.findUnique({ where: { id: site.id } })
    expect(updated!.paymentProvider).toBe('mollie')
  })

  it('rejects mollie without a Mollie access token in the database', async () => {
    const user = await createTestUser()
    const site = await createTestSite(user.id, { paymentProvider: 'stripe' })
    mockUserId = user.id

    // Create PartnerAccount WITHOUT mollieAccessToken
    await prisma.partnerAccount.create({
      data: {
        userId: user.id,
        firstName: 'Test',
        lastName: 'Partner',
        email: 'partner@test.com',
        phoneNumber: '+358401234567',
        company: 'Test Co',
        address: 'Test Street 1',
      },
    })

    const result = await setPaymentProvider(site.id, 'mollie')
    expect(result.status).toBe('error')
    expect(result.errors![0]).toMatch(/Mollie/)

    const unchanged = await prisma.site.findUnique({ where: { id: site.id } })
    expect(unchanged!.paymentProvider).toBe('stripe')
  })
})
