/**
 * Factory functions for creating test data.
 * Each function creates a minimal valid record with sensible defaults.
 */

import { prisma } from './setup'

let counter = 0
function nextId() {
  return `test-${++counter}-${Date.now()}`
}

export function resetCounter() {
  counter = 0
}

// ─── User ───────────────────────────────────────────────────────────────────

export async function createTestUser(overrides: Record<string, any> = {}) {
  return prisma.user.create({
    data: {
      email: `test-${nextId()}@test.com`,
      name: 'Test User',
      ...overrides,
    },
  })
}

// ─── Partner Account ────────────────────────────────────────────────────────

export async function createTestPartnerAccount(
  userId: string,
  overrides: Record<string, any> = {}
) {
  return prisma.partnerAccount.create({
    data: {
      userId,
      firstName: 'Test',
      lastName: 'Partner',
      email: 'partner@test.com',
      phoneNumber: '+358401234567',
      company: 'Test Company Oy',
      address: 'Test Street 1, Helsinki',
      businessId: 'FI12345678',
      ...overrides,
    },
  })
}

// ─── Site ───────────────────────────────────────────────────────────────────

export async function createTestSite(
  userId: string,
  overrides: Record<string, any> = {}
) {
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

// ─── Settings ───────────────────────────────────────────────────────────────

export async function createTestSettings(overrides: Record<string, any> = {}) {
  return prisma.settings.create({
    data: {
      country: 'FI',
      currency: 'EUR',
      vat: 25.5,
      companyName: 'Sunbnb Oy',
      vatId: 'FI99999999',
      companyAddress: 'Platform Street 1, Helsinki',
      ...overrides,
    },
  })
}

// ─── Service Fee ────────────────────────────────────────────────────────────

export async function createTestServiceFee(
  settingsId: string,
  overrides: Record<string, any> = {}
) {
  return prisma.serviceFee.create({
    data: {
      settingsId,
      serviceCode: 'sunbed-rental',
      chargeType: 'fixed',
      feeAmount: 1.0,
      ...overrides,
    },
  })
}

// ─── Inventory Item ─────────────────────────────────────────────────────────

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

// ─── Reservation ────────────────────────────────────────────────────────────

export async function createTestReservation(
  userId: string,
  siteId: string,
  itemIds: string[],
  overrides: Record<string, any> = {}
) {
  const from = overrides.from ?? new Date()
  const to = overrides.to ?? new Date(Date.now() + 4 * 60 * 60 * 1000)
  delete overrides.from
  delete overrides.to

  return prisma.reservation.create({
    data: {
      userId,
      siteId,
      from,
      to,
      status: 'pending',
      paymentAmount: 20.0,
      paymentRef: `pi_demo_${Date.now()}`,
      items: { connect: itemIds.map((id) => ({ id })) },
      ...overrides,
    },
    include: { items: true },
  })
}

// ─── Product ────────────────────────────────────────────────────────────────

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
      totalPrice: 8.0,
      ...overrides,
    },
  })
}

// ─── Order ──────────────────────────────────────────────────────────────────

export async function createTestOrder(
  userId: string,
  siteId: string,
  overrides: Record<string, any> = {}
) {
  return prisma.order.create({
    data: {
      userId,
      siteId,
      price: 30.0,
      tax: 14,
      totalPrice: 30.0,
      status: 'pending',
      paymentAmount: 30.0,
      paymentRef: `pi_demo_${Date.now()}`,
      ...overrides,
    },
  })
}

// ─── Order Item ─────────────────────────────────────────────────────────────

export async function createTestOrderItem(
  orderId: string,
  productId: string,
  overrides: Record<string, any> = {}
) {
  return prisma.orderItem.create({
    data: {
      orderId,
      productId,
      quantity: 1,
      name: 'Test Drink',
      price: 15.0,
      tax: 14,
      totalPrice: 15.0,
      ...overrides,
    },
  })
}

// ─── Restaurant ─────────────────────────────────────────────────────────────

export async function createTestRestaurant(
  partnerAccountId: string,
  overrides: Record<string, any> = {}
) {
  return prisma.restaurant.create({
    data: {
      partnerAccountId,
      name: 'Test Restaurant',
      slug: `test-restaurant-${nextId()}`,
      ...overrides,
    },
  })
}

// ─── TableReservation ────────────────────────────────────────────────────────

export async function createTestTableReservation(
  restaurantId: string,
  overrides: Record<string, any> = {}
) {
  const from = overrides.from ?? new Date()
  const to = overrides.to ?? new Date(Date.now() + 2 * 60 * 60 * 1000)
  const { from: _f, to: _t, ...rest } = overrides

  return prisma.tableReservation.create({
    data: {
      restaurantId,
      from,
      to,
      partySize: 2,
      guestName: 'Test Guest',
      guestEmail: 'guest@test.com',
      status: 'confirmed',
      operationalStatus: 'expected',
      ...rest,
    },
    include: { invoices: true },
  })
}

// ─── Subscription Plan + Subscription ───────────────────────────────────────

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
