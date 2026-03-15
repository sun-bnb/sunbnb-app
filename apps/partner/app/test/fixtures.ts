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
