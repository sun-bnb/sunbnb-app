import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import { createTestUser, createTestPartnerAccount, resetCounter } from './test/fixtures'
import {
  buildCommissionInvoice,
  listCommissionInvoices,
  commissionInvoiceMonths,
} from './commission-invoice'
import { PLATFORM_ES_ISSUER_NIF } from './tax/es-verifactu/sistema-informatico'

let seq = 0

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
  seq = 0
})
afterAll(async () => {
  await disconnectDatabase()
})

/** A partner, by country, so the recipient's jurisdiction can be varied. */
async function partner(country = 'ES', taxRegion: string | null = 'MA', businessId = 'B29806043') {
  const user = await createTestUser()
  await createTestPartnerAccount(user.id, {
    company: 'Alonso Beach SL',
    country,
    taxRegion,
    businessId,
  })
  return user.id
}

/** A commission invoice as `payment.ts` writes one: issuer us, recipient them. */
async function commissionInvoice(
  accountId: string,
  over: Record<string, unknown> = {},
) {
  seq += 1
  const inv = await prisma.invoice.create({
    data: {
      accountId,
      issuerType: 'PLATFORM',
      invoicedAt: new Date('2026-07-10T09:30:00Z'),
      totalCharge: 6,
      totalTax: 1.26,
      totalAmount: 7.26,
      issuerVatNumber: PLATFORM_ES_ISSUER_NIF,
      issuerCompanyName: 'Sunbnb España SL',
      issuerCompanyAddress: 'Fuengirola, Málaga',
      recipientVatNumber: 'B29806043',
      recipientCompanyName: 'Alonso Beach SL',
      recipientCompanyAddress: 'Marbella, Málaga',
      invoiceNumber: `PLATFORM-F-2026-${String(seq).padStart(5, '0')}`,
      ...over,
    },
  })
  await prisma.invoiceLine.create({
    data: {
      invoiceId: inv.id,
      charge: 6,
      tax: 1.26,
      amount: 7.26,
      vatRate: 21,
      productCode: 'sunbnb-service-fee',
      description: 'Comisión de plataforma',
    },
  })
  return inv
}

describe('buildCommissionInvoice', () => {
  it('builds a document naming BOTH parties', async () => {
    // It is a factura completa (F1), not a simplified receipt — the recipient is
    // identified, which is the structural reason ReceiptModel could not be reused.
    const accountId = await partner()
    const inv = await commissionInvoice(accountId)

    const doc = await buildCommissionInvoice(inv.id, accountId)
    expect(doc).not.toBeNull()
    expect(doc!.issuer).toMatchObject({ name: 'Sunbnb España SL', vatId: PLATFORM_ES_ISSUER_NIF })
    expect(doc!.recipient).toMatchObject({ name: 'Alonso Beach SL', vatId: 'B29806043' })
    expect(doc!.lines).toHaveLength(1)
    expect(doc!.totalAmount).toBe(7.26)
    expect(doc!.issuedOn).toBe('2026-07-10')
  })

  it('REFUSES another partner’s invoice, without saying it exists', async () => {
    // A commission invoice carries the partner's tax id and what they were
    // charged. Null for "not yours" and for "no such thing" alike, so a guessed
    // id cannot confirm the existence of someone else's.
    const mine = await partner()
    const theirs = await partner('ES', 'CA', 'B11111111')
    const inv = await commissionInvoice(theirs)

    expect(await buildCommissionInvoice(inv.id, mine)).toBeNull()
    expect(await buildCommissionInvoice('cmnosuchinvoice0000000001', mine)).toBeNull()
  })

  it('will not render a PARTNER invoice as a commission invoice', async () => {
    // Different document with different parties; serving a consumer receipt
    // through this path would print a recipient block full of nulls.
    const accountId = await partner()
    const inv = await prisma.invoice.create({
      data: {
        accountId,
        issuerType: 'PARTNER',
        invoicedAt: new Date('2026-07-10T09:30:00Z'),
        totalCharge: 100,
        totalTax: 21,
        totalAmount: 121,
        issuerVatNumber: 'B29806043',
        issuerCompanyName: 'Alonso Beach SL',
        invoiceNumber: 'AB-F-2026-00001',
      },
    })
    expect(await buildCommissionInvoice(inv.id, accountId)).toBeNull()
  })

  it('carries the reverse-charge flag so the document can declare it', async () => {
    // Art. 6.1.m RD 1619/2012 — a 0-VAT invoice must state WHY, and the presenter
    // cannot know from the amounts alone.
    const accountId = await partner('FI', null, 'FI29409571')
    const inv = await commissionInvoice(accountId, {
      reverseCharge: true,
      totalTax: 0,
      totalAmount: 6,
      recipientVatNumber: 'FI29409571',
    })

    const doc = await buildCommissionInvoice(inv.id, accountId)
    expect(doc!.reverseCharge).toBe(true)
  })

  it('gets a QR even when the RECIPIENT is not Spanish', async () => {
    // The bug `invoice-fiscal` fixes, seen through the loader: the issuer is
    // Sunbnb España SL whatever country the customer is in, and art. 20 attaches
    // to the issuer.
    const accountId = await partner('FI', null, 'FI29409571')
    const inv = await commissionInvoice(accountId)

    const doc = await buildCommissionInvoice(inv.id, accountId)
    expect(doc!.fiscal).not.toBeNull()
    expect(doc!.fiscal!.legendBelow).toBe('VERI*FACTU')
  })
})

describe('listCommissionInvoices', () => {
  it('returns one month, scoped to the account, newest first', async () => {
    const mine = await partner()
    const theirs = await partner('ES', 'CA', 'B11111111')

    await commissionInvoice(mine, { invoicedAt: new Date('2026-07-02T10:00:00Z') })
    await commissionInvoice(mine, { invoicedAt: new Date('2026-07-20T10:00:00Z') })
    await commissionInvoice(mine, { invoicedAt: new Date('2026-08-01T10:00:00Z') })
    await commissionInvoice(theirs)

    const july = await listCommissionInvoices(mine, 2026, 7)
    expect(july).toHaveLength(2)
    expect(july[0]!.invoicedAt.getTime()).toBeGreaterThan(july[1]!.invoicedAt.getTime())

    expect(await listCommissionInvoices(mine, 2026, 8)).toHaveLength(1)
    expect(await listCommissionInvoices(mine, 2026, 9)).toHaveLength(0)
  })

  it('excludes the partner’s OWN sales invoices', async () => {
    // The two streams are different documents. Mixing them is how the dashboard
    // figure and this list would come to disagree.
    const accountId = await partner()
    await commissionInvoice(accountId)
    await prisma.invoice.create({
      data: {
        accountId,
        issuerType: 'PARTNER',
        invoicedAt: new Date('2026-07-11T10:00:00Z'),
        totalCharge: 100,
        totalTax: 21,
        totalAmount: 121,
        invoiceNumber: 'AB-F-2026-09999',
      },
    })
    expect(await listCommissionInvoices(accountId, 2026, 7)).toHaveLength(1)
  })
})

describe('commissionInvoiceMonths', () => {
  it('lists only months that have invoices, newest first', async () => {
    // Feeds the month picker. Without it the page opens on the current month,
    // which for a seasonal business is empty most of the year and reads as broken.
    const accountId = await partner()
    await commissionInvoice(accountId, { invoicedAt: new Date('2026-06-15T10:00:00Z') })
    await commissionInvoice(accountId, { invoicedAt: new Date('2026-08-15T10:00:00Z') })
    await commissionInvoice(accountId, { invoicedAt: new Date('2026-08-16T10:00:00Z') })

    const months = await commissionInvoiceMonths(accountId)
    expect(months).toEqual([
      { year: 2026, month: 8, count: 2 },
      { year: 2026, month: 6, count: 1 },
    ])
  })

  it('does not leak another account’s months', async () => {
    const mine = await partner()
    const theirs = await partner('ES', 'CA', 'B11111111')
    await commissionInvoice(theirs)

    expect(await commissionInvoiceMonths(mine)).toEqual([])
  })
})
