import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import {
  createTestUser,
  createTestPartnerAccount,
  createTestSite,
  createTestInventoryItem,
  createTestReservation,
  createTestRestaurant,
  createTestTable,
  createTestTableTab,
  resetCounter,
} from './test/fixtures'
import {
  buildReservationReceipt,
  buildTabReceipt,
} from './receipt'

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
})
afterAll(async () => {
  await disconnectDatabase()
})

async function invoiceFor(
  accountId: string,
  data: Record<string, unknown>,
  lines: Record<string, unknown>[],
) {
  const inv = await prisma.invoice.create({
    data: {
      accountId,
      issuerType: 'PARTNER',
      invoicedAt: new Date('2026-07-10T09:30:00Z'),
      totalCharge: 100,
      totalTax: 21,
      totalAmount: 121,
      issuerCompanyName: 'Alonso Beach SL',
      issuerVatNumber: 'B22435705',
      issuerCompanyAddress: 'Av. Antonio Machado 41',
      invoiceNumber: 'AB-F-2026-00001',
      ...data,
    },
  })
  for (const l of lines) {
    await prisma.invoiceLine.create({
      data: { invoiceId: inv.id, charge: 0, tax: 0, amount: 0, ...l },
    })
  }
  return inv
}

describe('buildReservationReceipt', () => {
  async function setup() {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id, { company: 'Alonso Beach SL', phoneNumber: '+34 600' })
    const site = await createTestSite(user.id, { name: 'Alonso Beach' })
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const reservation = await createTestReservation(user.id, site.id, [item.id], {
      anonId: 'anon-1',
    })
    return { user, site, reservation }
  }

  it('builds the model a presenter renders', async () => {
    const { user, reservation } = await setup()
    await invoiceFor(user.id, { reservationId: reservation.id }, [
      { description: 'Sunbed 1-1-1', charge: 100, tax: 21, amount: 121, vatRate: 21 },
    ])

    const result = await buildReservationReceipt(reservation.id)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return

    expect(result.receipt).toMatchObject({
      kind: 'reservation',
      invoiceNumber: 'AB-F-2026-00001',
      issuedAt: '2026-07-10 09:30:00',
      siteName: 'Alonso Beach',
      tableLabel: null,
      merchant: {
        name: 'Alonso Beach SL',
        vatId: 'B22435705',
        address: 'Av. Antonio Machado 41',
        phone: '+34 600',
      },
      subtotalCharge: 100,
      subtotalVat: 21,
      grandTotal: 121,
    })
    expect(result.receipt.lines).toHaveLength(1)
    // Owner ids are returned so the route can check them without re-querying.
    expect(result.owner).toEqual({ userId: user.id, anonId: 'anon-1' })
  })

  it('scrapes the VAT country off a service-fee line', async () => {
    const { user, reservation } = await setup()
    await invoiceFor(user.id, { reservationId: reservation.id }, [
      { description: 'Sunbed', charge: 100, tax: 21, amount: 121, vatRate: 21 },
      { description: 'Reservation service fee (ES)', charge: 5, tax: 1, amount: 6, vatRate: 21 },
    ])

    const result = await buildReservationReceipt(reservation.id)
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.receipt.vatCountryCode).toBe('ES')
  })

  it('never renders a CREDIT NOTE as the receipt for the sale', async () => {
    // A credit note is a PARTNER invoice too. Picking it would show the guest a
    // negative document as though it were what they bought.
    const { user, reservation } = await setup()
    const receipt = await invoiceFor(user.id, { reservationId: reservation.id }, [
      { description: 'Sunbed', charge: 100, tax: 21, amount: 121, vatRate: 21 },
    ])
    await invoiceFor(
      user.id,
      {
        reservationId: reservation.id,
        creditsInvoiceId: receipt.id,
        invoiceNumber: 'AB-R-2026-00001',
        totalCharge: -100,
        totalTax: -21,
        totalAmount: -121,
      },
      [{ description: 'Credit note', charge: -100, tax: -21, amount: -121, vatRate: 21 }],
    )

    const result = await buildReservationReceipt(reservation.id)
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.receipt.invoiceNumber).toBe('AB-F-2026-00001')
    expect(result.receipt.grandTotal).toBe(121)
  })

  it('reports an unpaid reservation as not-ready, not as missing', async () => {
    // The guest is told "not yet", which is true, instead of "no such booking".
    const { reservation } = await setup()
    expect(await buildReservationReceipt(reservation.id)).toEqual({ status: 'no-invoice' })
  })

  it('reports an unknown id as not-found', async () => {
    expect(await buildReservationReceipt('clxdoesnotexist0000000000')).toEqual({
      status: 'not-found',
    })
  })
})

describe('buildTabReceipt', () => {
  // The surface that had no receipt at all — which is the primary obligation
  // unmet, not a rendering gap.
  async function setupTab(linked: boolean) {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id, { company: 'Gusto Bravo SL' })
    const site = linked ? await createTestSite(user.id, { name: 'Alonso Beach' }) : null
    const restaurant = await createTestRestaurant(user.id, {
      name: 'Gusto Bravo',
      siteId: site?.id ?? null,
    })
    const table = await createTestTable(restaurant.id, { number: 7, label: 'Terrace 7' })
    const tab = await createTestTableTab(table.id, site?.id ?? null, {
      restaurantId: restaurant.id,
      status: 'paid',
    })
    return { user, tab }
  }

  it('builds a receipt for a paid tab, naming the table', async () => {
    const { user, tab } = await setupTab(true)
    await invoiceFor(user.id, { tableTabId: tab.id }, [
      { description: 'Caña', charge: 3, tax: 0.63, amount: 3.63, vatRate: 21 },
    ])

    const result = await buildTabReceipt(tab.id)
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.receipt).toMatchObject({
      kind: 'tab',
      siteName: 'Alonso Beach',
      tableLabel: 'Terrace 7',
      seatNumbers: null,
      periodLabel: null,
    })
  })

  it('falls back to the restaurant name for a STANDALONE restaurant', async () => {
    const { user, tab } = await setupTab(false)
    await invoiceFor(user.id, { tableTabId: tab.id }, [
      { description: 'Caña', charge: 3, tax: 0.63, amount: 3.63, vatRate: 21 },
    ])

    const result = await buildTabReceipt(tab.id)
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.receipt.siteName).toBe('Gusto Bravo')
  })

  it('has NO owner to check — the tab id is the credential', async () => {
    // A table is shared: the person who opened the tab is routinely not the
    // one who pays, so gating on the opener would lock the payer out of the
    // receipt for their own meal.
    const { user, tab } = await setupTab(true)
    await invoiceFor(user.id, { tableTabId: tab.id }, [
      { description: 'Caña', charge: 3, tax: 0.63, amount: 3.63, vatRate: 21 },
    ])

    const result = await buildTabReceipt(tab.id)
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.owner).toBeNull()
  })

  it('reports an unpaid tab as not-ready', async () => {
    const { tab } = await setupTab(true)
    expect(await buildTabReceipt(tab.id)).toEqual({ status: 'no-invoice' })
  })
})
