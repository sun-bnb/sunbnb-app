import { prisma } from './setup'

let counter = 0
function nextId() {
  return `test-${++counter}-${Date.now()}`
}

export function resetCounter() {
  counter = 0
}

export async function createTestUser(overrides: Record<string, any> = {}) {
  return prisma.user.create({
    data: {
      email: `test-${nextId()}@test.com`,
      name: 'Test Partner',
      ...overrides,
    },
  })
}

/**
 * Creates a PartnerAccount for the given user.
 * Required before createTestSubscription — Subscription references PartnerAccount by userId.
 */
export async function createTestPartnerAccount(
  userId: string,
  overrides: Record<string, any> = {}
) {
  return prisma.partnerAccount.create({
    data: {
      userId,
      firstName: 'Test',
      lastName: 'Partner',
      email: `partner-${nextId()}@test.com`,
      phoneNumber: '+358401234567',
      company: 'Test Company Oy',
      address: 'Test Street 1, Helsinki',
      ...overrides,
    },
  })
}

/**
 * Creates a SubscriptionPlan + Subscription for the given partner account.
 * Grants the entitlements that come with the chosen tier (e.g. PRO/BUSINESS
 * both enable OFF_PLATFORM_BILLING).
 *
 * Requires a PartnerAccount to exist for the user first — call
 * createTestPartnerAccount() before this.
 */
export async function createTestSubscription(
  partnerAccountId: string,
  tier: 'STARTER' | 'PRO' | 'BUSINESS' = 'STARTER'
) {
  const plan = await prisma.subscriptionPlan.create({
    data: {
      tier,
      name: `${tier} Plan`,
      monthlyPrice: tier === 'STARTER' ? 9.99 : tier === 'PRO' ? 29.99 : 79.99,
      maxSites: tier === 'STARTER' ? 1 : tier === 'PRO' ? 5 : 20,
    },
  })

  const subscription = await prisma.subscription.create({
    data: {
      partnerAccountId,
      planId: plan.id,
      status: 'ACTIVE',
    },
  })

  return { plan, subscription }
}

export async function createTestSite(userId: string, overrides: Record<string, any> = {}) {
  return prisma.site.create({
    data: {
      userId,
      name: 'Test Beach',
      locationLat: '60.1699',
      locationLng: '24.9384',
      price: 10.0,
      vat: 25.5,
      ...overrides,
    },
  })
}

export async function createTestInventoryItem(
  userId: string,
  siteId: string,
  overrides: Record<string, any> = {}
) {
  return prisma.inventoryItem.create({
    data: {
      userId,
      siteId,
      number: overrides.number ?? 1,
      locationLat: '60.1699',
      locationLng: '24.9384',
      status: 'active',
      category: 'standard',
      ...overrides,
    },
  })
}

export async function createTestProduct(
  siteId: string,
  overrides: Record<string, any> = {}
) {
  return prisma.product.create({
    data: {
      siteId,
      name: 'Test Drink',
      price: 8.0,
      tax: 14,
      totalPrice: 9.12,
      active: true,
      ...overrides,
    },
  })
}

export async function createTestRentalItem(
  siteId: string,
  overrides: Record<string, any> = {}
) {
  return prisma.rentalItem.create({
    data: {
      siteId,
      name: 'Beach Umbrella',
      totalQuantity: 10,
      pricePerDay: 15.0,
      active: true,
      ...overrides,
    },
  })
}

/**
 * Creates a real SecurityToken row in sunbnb_test.
 *
 * @param userId    - The user who owns the token (must match site.userId for ownership checks)
 * @param resources - The resource scopes on the token (e.g. ['all'], ['manage_site'], ['all','manage_site'])
 * @param expiresOffsetMs - Milliseconds from now for expiry. Positive = future (valid), negative = past (expired).
 *                          Defaults to +24 hours (valid).
 */
export async function createTestSecurityToken(
  userId: string,
  resources: string[] = ['all'],
  expiresOffsetMs: number = 24 * 60 * 60 * 1000
) {
  return prisma.securityToken.create({
    data: {
      userId,
      resources,
      expires: new Date(Date.now() + expiresOffsetMs),
    },
  })
}

export async function createTestReservation(
  userId: string,
  siteId: string,
  itemIds: string[],
  overrides: Record<string, any> = {}
) {
  const from = overrides.from ?? new Date()
  const to = overrides.to ?? new Date(Date.now() + 4 * 60 * 60 * 1000)
  const { from: _f, to: _t, ...rest } = overrides

  return prisma.reservation.create({
    data: {
      userId,
      siteId,
      from,
      to,
      type: 'days',
      status: 'pending',
      paymentAmount: 20.0,
      items: { connect: itemIds.map((id) => ({ id })) },
      ...rest,
    },
    include: { items: true },
  })
}
