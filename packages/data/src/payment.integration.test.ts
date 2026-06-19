import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

// Mock email modules to prevent real email sends
vi.mock('./email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: 'mock-email' }),
}))
vi.mock('./reservation-emails', () => ({
  sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./rental-emails', () => ({
  sendRentalConfirmationEmail: vi.fn().mockResolvedValue(undefined),
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
  createTestRentalItem,
  createTestRentalBooking,
  resetCounter,
} from './test/fixtures'
import {
  processConfirmedReservation,
  processConfirmedOrder,
  processConfirmedRentalBooking,
  computeVatAndBaseAmounts,
} from './payment'
import { sendRentalConfirmationEmail } from './rental-emails'
import { RESERVATION_COMPLETE, ORDER_COMPLETE, RENTAL_COMPLETE } from './reservation-status'

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

    // Agent model: PARTNER invoice is GROSS — 2 items × 10.0 = 20.0 (full price
    // the consumer paid). Commission (2 × 1.0 = 2.0) is billed separately.
    expect(partnerInvoice.totalAmount).toBe(20.0)
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

    // One line per sunbed, at the full listed price (gross)
    expect(partnerInvoice.invoiceLines).toHaveLength(2)
    for (const line of partnerInvoice.invoiceLines) {
      expect(line.amount).toBe(10.0) // full listed price
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
    // 10.0 at 25.5%: base = round(10.0 / 1.255)
    const expected = computeVatAndBaseAmounts(10.0, 25.5)
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
    const { reservation: res1, user, site } = await setupReservation()

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

    // 10% of 10.0 per item = 1.0 per item, 2.0 total commission.
    // PARTNER invoice is gross: 2 × 10.0 = 20.0.
    expect(platformInvoice.totalAmount).toBe(2.0)
    expect(partnerInvoice.totalAmount).toBe(20.0)
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

    // Gross (full listed price): item2 = 10.0, item1 = 15.0
    expect(amounts).toEqual([10.0, 15.0])
  })

  it('throws for non-existent reservation', async () => {
    await expect(
      processConfirmedReservation('nonexistent-id')
    ).rejects.toThrow('Reservation not found')
  })

  it('sets the partner as recipient (bill-to) on the commission invoice', async () => {
    const { reservation, partner } = await setupReservation()

    await processConfirmedReservation(reservation.id)

    const platformInvoice = await prisma.invoice.findFirst({
      where: { reservationId: reservation.id, issuerType: 'PLATFORM' },
    })

    // The PLATFORM invoice is a B2B commission billed TO the partner.
    expect(platformInvoice!.recipientCompanyName).toBe(partner.company)
    expect(platformInvoice!.recipientVatNumber).toBe(partner.businessId)
    expect(platformInvoice!.recipientCompanyAddress).toBe(partner.address)
    // Same-country (partner has no country set → falls back to local VAT).
    expect(platformInvoice!.reverseCharge).toBe(false)
    expect(platformInvoice!.totalTax).toBeGreaterThan(0)
  })

  it('reverse-charges the commission for a cross-border EU partner', async () => {
    const user = await createTestUser()
    // Partner VAT-registered in ES; platform (settings) is FI → cross-border B2B.
    await createTestPartnerAccount(user.id, {
      country: 'ES',
      businessId: 'ESX1234567B',
    })
    const site = await createTestSite(user.id)
    const settings = await createTestSettings() // country: 'FI'
    await createTestServiceFee(settings.id)
    const item1 = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const reservation = await createTestReservation(user.id, site.id, [item1.id], {
      paymentAmount: 10.0,
    })

    await processConfirmedReservation(reservation.id)

    const platformInvoice = await prisma.invoice.findFirst({
      where: { reservationId: reservation.id, issuerType: 'PLATFORM' },
      include: { invoiceLines: true },
    })

    // Reverse charge: 0 VAT, partner self-accounts; commission amount unchanged.
    expect(platformInvoice!.reverseCharge).toBe(true)
    expect(platformInvoice!.totalTax).toBe(0)
    expect(platformInvoice!.totalAmount).toBe(1.0)
    expect(platformInvoice!.invoiceLines[0]!.tax).toBe(0)
    expect(platformInvoice!.invoiceLines[0]!.vatRate).toBe(0)

    // The partner sale (PARTNER invoice) is unaffected — still gross.
    const partnerInvoice = await prisma.invoice.findFirst({
      where: { reservationId: reservation.id, issuerType: 'PARTNER' },
    })
    expect(partnerInvoice!.totalAmount).toBe(10.0)
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

  it('books partner lines gross and commission separately', async () => {
    const { order } = await setupOrder()

    await processConfirmedOrder(order.id)

    const partnerInvoice = await prisma.invoice.findFirst({
      where: { orderId: order.id, issuerType: 'PARTNER' },
    })
    const platformInvoice = await prisma.invoice.findFirst({
      where: { orderId: order.id, issuerType: 'PLATFORM' },
    })

    // Agent model: PARTNER invoice is gross — Beer 7.0 + Cocktail 12.0 = 19.0
    // (the full prices the consumer paid). Commission (fixed 1.0) is billed
    // separately to the partner on the PLATFORM invoice.
    expect(platformInvoice!.totalAmount).toBe(1.0)
    expect(partnerInvoice!.totalAmount).toBe(19.0)
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
    await createTestPartnerAccount(user.id)
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

// ─── processConfirmedRentalBooking ──────────────────────────────────────────

describe('processConfirmedRentalBooking', () => {
  const mockSendRentalConfirmationEmail = vi.mocked(sendRentalConfirmationEmail)

  async function setupRental(overrides?: {
    siteOverrides?: Record<string, any>
    feeOverrides?: Record<string, any>
    bookingOverrides?: Record<string, any>
    rentalItemOverrides?: Record<string, any>
  }) {
    const user = await createTestUser()
    const partner = await createTestPartnerAccount(user.id)
    const site = await createTestSite(user.id, {
      rentalVat: 25.5,
      ...overrides?.siteOverrides,
    })
    const settings = await createTestSettings()
    const fee = await createTestServiceFee(settings.id, {
      serviceCode: 'equipment-rental',
      chargeType: 'fixed',
      feeAmount: 1.0,
      ...overrides?.feeOverrides,
    })
    const rentalItem = await createTestRentalItem(site.id, {
      name: 'Surfboard',
      ...overrides?.rentalItemOverrides,
    })
    const paymentRef = `pi_demo_${Date.now()}`
    const booking = await createTestRentalBooking(user.id, site.id, rentalItem.id, {
      paymentRef,
      status: 'pending',
      paymentAmount: 10.0,
      totalPrice: 10.0,
      ...overrides?.bookingOverrides,
    })

    return { user, partner, site, settings, fee, rentalItem, booking, paymentRef }
  }

  beforeEach(() => {
    mockSendRentalConfirmationEmail.mockClear()
  })

  it('creates PARTNER and PLATFORM invoices with correct amounts', async () => {
    const { paymentRef } = await setupRental()

    await processConfirmedRentalBooking(paymentRef)

    const invoices = await prisma.invoice.findMany({
      where: { paymentRef },
    })

    expect(invoices).toHaveLength(2)
    const partnerInvoice = invoices.find((i) => i.issuerType === 'PARTNER')!
    const platformInvoice = invoices.find((i) => i.issuerType === 'PLATFORM')!

    // Agent model: PARTNER is GROSS (10.0 full consumer price), PLATFORM is commission (1.0)
    expect(partnerInvoice.totalAmount).toBe(10.0)
    expect(platformInvoice.totalAmount).toBe(1.0)
  })

  it('creates one invoice line per rental booking', async () => {
    const { paymentRef, user, site, rentalItem } = await setupRental()

    // Add a second booking to the same paymentRef
    await createTestRentalBooking(user.id, site.id, rentalItem.id, {
      paymentRef,
      status: 'pending',
      paymentAmount: 15.0,
      totalPrice: 15.0,
    })

    await processConfirmedRentalBooking(paymentRef)

    const partnerInvoice = await prisma.invoice.findFirst({
      where: { paymentRef, issuerType: 'PARTNER' },
      include: { invoiceLines: true },
    })

    // One line per booking
    expect(partnerInvoice!.invoiceLines).toHaveLength(2)
    const amounts = partnerInvoice!.invoiceLines.map((l) => l.amount).sort((a, b) => a - b)
    expect(amounts).toEqual([10.0, 15.0])
  })

  it('marks all bookings in the group as complete', async () => {
    const { paymentRef, booking } = await setupRental()

    await processConfirmedRentalBooking(paymentRef)

    const updated = await prisma.rentalBooking.findUnique({ where: { id: booking.id } })
    expect(updated!.status).toBe(RENTAL_COMPLETE)
  })

  it('is idempotent — calling twice does not create duplicate invoices', async () => {
    const { paymentRef } = await setupRental()

    await processConfirmedRentalBooking(paymentRef)
    await processConfirmedRentalBooking(paymentRef)

    const invoices = await prisma.invoice.findMany({ where: { paymentRef } })
    expect(invoices).toHaveLength(2)
  })

  it('skips processing when all bookings are already complete', async () => {
    const { paymentRef } = await setupRental({
      bookingOverrides: { status: RENTAL_COMPLETE },
    })

    await processConfirmedRentalBooking(paymentRef)

    const invoices = await prisma.invoice.findMany({ where: { paymentRef } })
    expect(invoices).toHaveLength(0)
  })

  it('calls sendRentalConfirmationEmail after invoices are created', async () => {
    const { paymentRef, booking } = await setupRental()

    await processConfirmedRentalBooking(paymentRef)

    // Email is called asynchronously (fire-and-forget), so allow the microtask queue to flush
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockSendRentalConfirmationEmail).toHaveBeenCalledOnce()
    expect(mockSendRentalConfirmationEmail).toHaveBeenCalledWith(booking.id)
  })

  it('does not call sendRentalConfirmationEmail when already complete (idempotent skip)', async () => {
    const { paymentRef } = await setupRental({
      bookingOverrides: { status: RENTAL_COMPLETE },
    })

    await processConfirmedRentalBooking(paymentRef)

    // No invoice created = no email sent
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockSendRentalConfirmationEmail).not.toHaveBeenCalled()
  })

  it('throws for non-existent paymentRef', async () => {
    await expect(
      processConfirmedRentalBooking('nonexistent-ref')
    ).rejects.toThrow('No rental bookings found for paymentRef')
  })

  it('computes VAT reverse calculation correctly on partner invoice lines', async () => {
    const { paymentRef } = await setupRental()

    await processConfirmedRentalBooking(paymentRef)

    const partnerInvoice = await prisma.invoice.findFirst({
      where: { paymentRef, issuerType: 'PARTNER' },
      include: { invoiceLines: true },
    })

    const line = partnerInvoice!.invoiceLines[0]!
    // 10.0 at 25.5%: base = round(10.0 / 1.255)
    const expected = computeVatAndBaseAmounts(10.0, 25.5)
    expect(line.charge).toBe(expected.baseAmount)
    expect(line.tax).toBe(expected.vatAmount)
    expect(line.vatRate).toBe(25.5)
  })
})
