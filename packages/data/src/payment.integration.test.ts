import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

// Mock email modules to prevent real email sends
vi.mock('./email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: 'mock-email' }),
}))
vi.mock('./reservation-emails', () => ({
  sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
}))

import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import {
  createTestUser,
  createTestPartnerAccount,
  createTestSite,
  createTestSettings,
  createTestServiceFee,
  createTestInventoryItem,
  createTestReservation,
  createTestOrder,
  createTestOrderItem,
  createTestProduct,
  resetCounter,
} from './test/fixtures'
import {
  processConfirmedReservation,
  processConfirmedOrder,
  round,
  computeVatAndBaseAmounts,
} from './payment'
import { RESERVATION_COMPLETE, ORDER_COMPLETE } from './reservation-status'

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
})

afterAll(async () => {
  await disconnectDatabase()
})

// ─── processConfirmedReservation ────────────────────────────────────────────

describe('processConfirmedReservation', () => {
  async function setupReservation(overrides?: {
    siteOverrides?: Record<string, any>
    feeOverrides?: Record<string, any>
    itemOverrides?: Array<Record<string, any>>
    reservationOverrides?: Record<string, any>
  }) {
    const user = await createTestUser()
    const partner = await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id, overrides?.siteOverrides)
    const settings = await createTestSettings()
    const fee = await createTestServiceFee(settings.id, overrides?.feeOverrides)

    const item1Overrides = overrides?.itemOverrides?.[0] ?? {}
    const item2Overrides = overrides?.itemOverrides?.[1] ?? {}
    const item1 = await createTestInventoryItem(user.id, site.id, {
      number: 1,
      ...item1Overrides,
    })
    const item2 = await createTestInventoryItem(user.id, site.id, {
      number: 2,
      ...item2Overrides,
    })

    const reservation = await createTestReservation(
      user.id,
      site.id,
      [item1.id, item2.id],
      overrides?.reservationOverrides
    )

    return { user, partner, site, settings, fee, item1, item2, reservation }
  }

  it('creates PARTNER and PLATFORM invoices with correct amounts', async () => {
    const { reservation } = await setupReservation()

    await processConfirmedReservation(reservation.id)

    const invoices = await prisma.invoice.findMany({
      where: { reservationId: reservation.id },
      orderBy: { issuerType: 'asc' },
    })

    expect(invoices).toHaveLength(2)

    const partnerInvoice = invoices.find((i) => i.issuerType === 'PARTNER')!
    const platformInvoice = invoices.find((i) => i.issuerType === 'PLATFORM')!

    // 2 items × 10.0, fee = 2 × 1.0 = 2.0, partner = 20 - 2 = 18.0
    expect(partnerInvoice.totalAmount).toBe(18.0)
    expect(platformInvoice.totalAmount).toBe(2.0)
  })

  it('creates correct invoice lines per sunbed item', async () => {
    const { reservation } = await setupReservation()

    await processConfirmedReservation(reservation.id)

    const invoices = await prisma.invoice.findMany({
      where: { reservationId: reservation.id },
      include: { invoiceLines: true },
    })

    const partnerInvoice = invoices.find((i) => i.issuerType === 'PARTNER')!
    const platformInvoice = invoices.find((i) => i.issuerType === 'PLATFORM')!

    // One line per sunbed
    expect(partnerInvoice.invoiceLines).toHaveLength(2)
    for (const line of partnerInvoice.invoiceLines) {
      expect(line.amount).toBe(9.0) // 10.0 - 1.0 fee
      expect(line.vatRate).toBe(25.5)
      expect(line.productCode).toBe('sunbed-rental')
    }

    // Single fee line
    expect(platformInvoice.invoiceLines).toHaveLength(1)
    expect(platformInvoice.invoiceLines[0]!.amount).toBe(2.0)
    expect(platformInvoice.invoiceLines[0]!.productCode).toBe('sunbnb-service-fee')
  })

  it('sets reservation status to complete', async () => {
    const { reservation } = await setupReservation()

    await processConfirmedReservation(reservation.id)

    const updated = await prisma.reservation.findUnique({
      where: { id: reservation.id },
    })
    expect(updated!.status).toBe(RESERVATION_COMPLETE)
  })

  it('computes VAT reverse calculation correctly on invoice lines', async () => {
    const { reservation } = await setupReservation()

    await processConfirmedReservation(reservation.id)

    const partnerInvoice = await prisma.invoice.findFirst({
      where: { reservationId: reservation.id, issuerType: 'PARTNER' },
      include: { invoiceLines: true },
    })

    const line = partnerInvoice!.invoiceLines[0]!
    // 9.0 at 25.5%: base = round(9.0 / 1.255)
    const expected = computeVatAndBaseAmounts(9.0, 25.5)
    expect(line.charge).toBe(expected.baseAmount)
    expect(line.tax).toBe(expected.vatAmount)
  })

  it('is idempotent — calling twice does not create duplicate invoices', async () => {
    const { reservation } = await setupReservation()

    await processConfirmedReservation(reservation.id)
    await processConfirmedReservation(reservation.id)

    const invoices = await prisma.invoice.findMany({
      where: { reservationId: reservation.id },
    })
    expect(invoices).toHaveLength(2)
  })

  it('skips processing when status is already complete', async () => {
    const { reservation } = await setupReservation({
      reservationOverrides: { status: 'complete' },
    })

    await processConfirmedReservation(reservation.id)

    const invoices = await prisma.invoice.findMany({
      where: { reservationId: reservation.id },
    })
    expect(invoices).toHaveLength(0)
  })

  it('chains invoice hashes correctly across sequential reservations', async () => {
    const { reservation: res1, user, site, settings } = await setupReservation()

    await processConfirmedReservation(res1.id)

    // Create second reservation
    const item3 = await createTestInventoryItem(user.id, site.id, { number: 3 })
    const item4 = await createTestInventoryItem(user.id, site.id, { number: 4 })
    const res2 = await createTestReservation(user.id, site.id, [item3.id, item4.id])

    await processConfirmedReservation(res2.id)

    const partnerInvoices = await prisma.invoice.findMany({
      where: { issuerType: 'PARTNER' },
      orderBy: { invoiceNumber: 'asc' },
    })

    expect(partnerInvoices).toHaveLength(2)
    expect(partnerInvoices[1]!.previousHash).toBe(partnerInvoices[0]!.hash)
  })

  it('generates sequential invoice numbers', async () => {
    const { reservation: res1, user, site } = await setupReservation()

    await processConfirmedReservation(res1.id)

    const item3 = await createTestInventoryItem(user.id, site.id, { number: 3 })
    const item4 = await createTestInventoryItem(user.id, site.id, { number: 4 })
    const res2 = await createTestReservation(user.id, site.id, [item3.id, item4.id])

    await processConfirmedReservation(res2.id)

    const year = new Date().getFullYear()
    const partnerInvoices = await prisma.invoice.findMany({
      where: { issuerType: 'PARTNER' },
      orderBy: { invoiceNumber: 'asc' },
    })

    expect(partnerInvoices[0]!.invoiceNumber).toBe(`PARTNER-${year}-00001`)
    expect(partnerInvoices[1]!.invoiceNumber).toBe(`PARTNER-${year}-00002`)
  })

  it('handles percentage-based service fee', async () => {
    const { reservation } = await setupReservation({
      feeOverrides: {
        chargeType: 'percentage',
        percentage: 10,
        feeAmount: null,
      },
    })

    await processConfirmedReservation(reservation.id)

    const invoices = await prisma.invoice.findMany({
      where: { reservationId: reservation.id },
    })

    const partnerInvoice = invoices.find((i) => i.issuerType === 'PARTNER')!
    const platformInvoice = invoices.find((i) => i.issuerType === 'PLATFORM')!

    // 10% of 10.0 per item = 1.0 per item, 2.0 total
    expect(platformInvoice.totalAmount).toBe(2.0)
    expect(partnerInvoice.totalAmount).toBe(18.0)
  })

  it('uses item-level price when set, falls back to site price', async () => {
    const { reservation } = await setupReservation({
      itemOverrides: [{ price: 15.0 }, {}], // item1 = 15.0, item2 = null → site price 10.0
      reservationOverrides: { paymentAmount: 25.0 },
    })

    await processConfirmedReservation(reservation.id)

    const partnerInvoice = await prisma.invoice.findFirst({
      where: { reservationId: reservation.id, issuerType: 'PARTNER' },
      include: { invoiceLines: true },
    })

    const amounts = partnerInvoice!.invoiceLines
      .map((l) => l.amount)
      .sort((a, b) => a - b)

    // item2: 10.0 - 1.0 fee = 9.0, item1: 15.0 - 1.0 fee = 14.0
    expect(amounts).toEqual([9.0, 14.0])
  })

  it('throws for non-existent reservation', async () => {
    await expect(
      processConfirmedReservation('nonexistent-id')
    ).rejects.toThrow('Reservation not found')
  })
})

// ─── processConfirmedOrder ──────────────────────────────────────────────────

describe('processConfirmedOrder', () => {
  async function setupOrder(overrides?: {
    feeOverrides?: Record<string, any>
    orderItemsConfig?: Array<{
      name: string
      price: number
      tax: number
      totalPrice: number
      quantity: number
    }>
  }) {
    const user = await createTestUser()
    const partner = await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const settings = await createTestSettings()
    const fee = await createTestServiceFee(settings.id, {
      serviceCode: 'food-and-beverage',
      ...overrides?.feeOverrides,
    })

    const items = overrides?.orderItemsConfig ?? [
      { name: 'Beer', price: 7.0, tax: 14, totalPrice: 7.0, quantity: 1 },
      { name: 'Cocktail', price: 12.0, tax: 24, totalPrice: 12.0, quantity: 1 },
    ]

    const totalPrice = items.reduce((sum, i) => sum + i.totalPrice, 0)
    const order = await createTestOrder(user.id, site.id, {
      price: totalPrice,
      tax: 0,
      totalPrice,
      paymentAmount: totalPrice,
    })

    const product = await createTestProduct(site.id)

    const orderItems = []
    for (const item of items) {
      const oi = await createTestOrderItem(order.id, product.id, item)
      orderItems.push(oi)
    }

    return { user, partner, site, settings, fee, order, orderItems }
  }

  it('creates PARTNER and PLATFORM invoices', async () => {
    const { order } = await setupOrder()

    await processConfirmedOrder(order.id)

    const invoices = await prisma.invoice.findMany({
      where: { orderId: order.id },
    })
    expect(invoices).toHaveLength(2)
    expect(invoices.map((i) => i.issuerType).sort()).toEqual([
      'PARTNER',
      'PLATFORM',
    ])
  })

  it('uses per-item VAT rate on invoice lines', async () => {
    const { order } = await setupOrder()

    await processConfirmedOrder(order.id)

    const partnerInvoice = await prisma.invoice.findFirst({
      where: { orderId: order.id, issuerType: 'PARTNER' },
      include: { invoiceLines: true },
    })

    const vatRates = partnerInvoice!.invoiceLines
      .map((l) => l.vatRate)
      .sort((a, b) => (a ?? 0) - (b ?? 0))

    expect(vatRates).toEqual([14, 24])
  })

  it('deducts service fee from partner amount', async () => {
    const { order } = await setupOrder()

    await processConfirmedOrder(order.id)

    const partnerInvoice = await prisma.invoice.findFirst({
      where: { orderId: order.id, issuerType: 'PARTNER' },
    })
    const platformInvoice = await prisma.invoice.findFirst({
      where: { orderId: order.id, issuerType: 'PLATFORM' },
    })

    // Platform fee: calculateServiceFeeAmount(fixedFee=1.0, totalPayment=19.0) = 1.0
    // Per-line deductions: each item deducts calculateServiceFeeAmount(fixedFee=1.0, itemPrice)
    // Beer 7.0 → deduct 1.0 → partner 6.0, Cocktail 12.0 → deduct 1.0 → partner 11.0
    // Total partner lines = 17.0, platform invoice = 1.0
    expect(platformInvoice!.totalAmount).toBe(1.0)
    expect(partnerInvoice!.totalAmount).toBe(17.0)
  })

  it('is idempotent — calling twice creates only 2 invoices', async () => {
    const { order } = await setupOrder()

    await processConfirmedOrder(order.id)
    await processConfirmedOrder(order.id)

    const invoices = await prisma.invoice.findMany({
      where: { orderId: order.id },
    })
    expect(invoices).toHaveLength(2)
  })

  it('sets order status to complete', async () => {
    const { order } = await setupOrder()

    await processConfirmedOrder(order.id)

    const updated = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updated!.status).toBe(ORDER_COMPLETE)
  })

  it('throws for non-existent order', async () => {
    await expect(processConfirmedOrder('nonexistent-id')).rejects.toThrow(
      'Order not found'
    )
  })

  it('maintains hash chain across reservation and order invoices', async () => {
    // Process a reservation first to establish chain
    const user = await createTestUser()
    const partner = await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id)
    const settings = await createTestSettings()
    await createTestServiceFee(settings.id)
    await createTestServiceFee(settings.id, {
      serviceCode: 'food-and-beverage',
    })

    const item1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const item2 = await createTestInventoryItem(user.id, site.id, { number: 2 })
    const reservation = await createTestReservation(user.id, site.id, [
      item1.id,
      item2.id,
    ])
    await processConfirmedReservation(reservation.id)

    // Now process an order
    const product = await createTestProduct(site.id)
    const order = await createTestOrder(user.id, site.id, {
      price: 10.0,
      tax: 14,
      totalPrice: 10.0,
      paymentAmount: 10.0,
    })
    await createTestOrderItem(order.id, product.id, {
      name: 'Beer',
      price: 10.0,
      tax: 14,
      totalPrice: 10.0,
    })
    await processConfirmedOrder(order.id)

    // Check PARTNER chain
    const partnerInvoices = await prisma.invoice.findMany({
      where: { issuerType: 'PARTNER' },
      orderBy: { invoiceNumber: 'asc' },
    })
    expect(partnerInvoices).toHaveLength(2)
    expect(partnerInvoices[1]!.previousHash).toBe(partnerInvoices[0]!.hash)
  })
})
