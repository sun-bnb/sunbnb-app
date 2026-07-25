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
      name: 'Test User',
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
      type: 'paid',
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

export async function createTestRentalBooking(
  siteId: string,
  rentalItemId: string,
  userId: string,
  overrides: Record<string, any> = {}
) {
  return prisma.rentalBooking.create({
    data: {
      siteId,
      rentalItemId,
      userId,
      from: new Date('2025-07-01T10:00:00Z'),
      to: new Date('2025-07-03T10:00:00Z'),
      quantity: 1,
      durationType: 'days',
      totalPrice: 30.0,
      paymentAmount: 30.0,
      status: 'pending',
      ...overrides,
    },
  })
}

export async function createTestSunbedGroup(
  siteId: string,
  itemIds: string[]
) {
  const group = await prisma.sunbedGroup.create({
    data: { siteId },
  })
  // Connect each item to the group
  await prisma.inventoryItem.updateMany({
    where: { id: { in: itemIds } },
    data: { sunbedGroupId: group.id },
  })
  return group
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
      businessId: 'FI12345678',
      ...overrides,
    },
  })
}

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

export async function createTestTable(
  restaurantId: string,
  overrides: Record<string, any> = {}
) {
  return prisma.table.create({
    data: {
      restaurantId,
      number: overrides.number ?? ++counter,
      capacity: 4,
      shape: 'square',
      status: 'active',
      ...overrides,
    },
  })
}

/**
 * Create a test TableTab.
 * Defaults: status = 'open', openTableId = tableId (concurrency guard set).
 * Caller must supply restaurantId via overrides (it is a required column).
 * Pass siteId = null for a standalone-restaurant tab (dine-in v2).
 */
export async function createTestTableTab(
  tableId: string,
  siteId: string | null,
  overrides: Record<string, any> = {}
) {
  return prisma.tableTab.create({
    data: {
      tableId,
      siteId,
      status: 'open',
      openTableId: tableId,
      openedAt: new Date(),
      ...overrides,
    },
  })
}

/**
 * Create a test MenuItem (dine-in v2 orderable catalog). VAT triple mirrors
 * Product: totalPrice is gross, price is the derived net base.
 */
export async function createTestMenuItem(
  restaurantId: string,
  overrides: Record<string, any> = {}
) {
  return prisma.menuItem.create({
    data: {
      restaurantId,
      name: 'Test Dish',
      price: 8.0,
      tax: 14,
      totalPrice: 8.0,
      category: 'food',
      ...overrides,
    },
  })
}
