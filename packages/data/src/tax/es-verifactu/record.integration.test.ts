import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from '../../test/setup'
import {
  createTestUser,
  createTestPartnerAccount,
  createTestSite,
  createTestInventoryItem,
  createTestReservation,
  createTestSettings,
  createTestServiceFee,
  resetCounter,
} from '../../test/fixtures'
import { processConfirmedReservation } from '../../payment'
import { PLATFORM_ES_ISSUER_NIF } from './sistema-informatico'
import { recordInvoiceForTax } from './record'
import { HUELLA_SPEC_VERSION } from './huella'

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
})
afterAll(async () => {
  await disconnectDatabase()
})

const SIF = {
  nombreRazon: 'Sunbnb España SL',
  nif: 'B22435705',
  nombreSistemaInformatico: 'Sunbnb',
  idSistemaInformatico: '01',
  version: '1.0',
  numeroInstalacion: '001',
}

/** A Spanish partner in common territory — the in-scope case. */
async function spanishPartner(overrides: Record<string, unknown> = {}) {
  const user = await createTestUser()
  await createTestPartnerAccount(user.id, {
    company: 'Alonso Beach SL',
    country: 'ES',
    taxRegion: 'MA',
    businessId: 'B22435705',
    ...overrides,
  })
  return user.id
}

async function invoiceFor(
  accountId: string,
  data: Record<string, unknown> = {},
  lines: Record<string, unknown>[] = [
    { charge: 100, tax: 21, amount: 121, vatRate: 21, productCode: 'sunbed-rental' },
  ],
) {
  const inv = await prisma.invoice.create({
    data: {
      accountId,
      issuerType: 'PARTNER',
      invoicedAt: new Date('2026-07-10T09:30:00Z'),
      totalCharge: 100,
      totalTax: 21,
      totalAmount: 121,
      issuerVatNumber: 'B22435705',
      invoiceNumber: `AB-F-2026-0000${Math.floor(Math.random() * 90000) + 10000}`,
      ...data,
    },
  })
  for (const l of lines) {
    await prisma.invoiceLine.create({ data: { invoiceId: inv.id, charge: 0, tax: 0, amount: 0, ...l } })
  }
  return inv
}

const record = (invoiceId: string) =>
  prisma.$transaction((tx) => recordInvoiceForTax(tx, invoiceId, SIF))

describe('recordInvoiceForTax', () => {
  it('writes a filable record for a Spanish issuer', async () => {
    const account = await spanishPartner()
    const invoice = await invoiceFor(account)

    const outcome = await record(invoice.id)
    expect(outcome.status).toBe('created')

    const rec = await prisma.verifactuRecord.findFirst({ where: { invoiceId: invoice.id } })
    expect(rec).toMatchObject({
      recordType: 'ALTA',
      issuerNif: 'B22435705',
      tipoFactura: 'F2',          // consumer receipt, no recipient
      tipoRectificativa: null,
      chainSeq: 1,
      huellaPrevious: null,
      specVersion: HUELLA_SPEC_VERSION,
      status: 'pending',
    })
    // Date in the ISSUER's territory: 09:30Z on 10 July is 11:30 in Madrid.
    expect(rec!.fechaExpedicion).toBe('10-07-2026')
    expect(rec!.fechaHoraHusoGenRegistro).toMatch(/\+0[12]:00$/)
  })

  it('stores a huella that can be recomputed from its own stored input', async () => {
    // The stored huellaInput is the only way to debug a disagreement, since
    // AEAT reports that the huella differs without saying which field did.
    const account = await spanishPartner()
    const invoice = await invoiceFor(account)
    await record(invoice.id)

    const rec = await prisma.verifactuRecord.findFirstOrThrow({ where: { invoiceId: invoice.id } })
    expect(rec.huellaInput).toContain(`IDEmisorFactura=${rec.issuerNif}`)
    expect(rec.huellaInput).toContain('&Huella=&')   // first record, empty previous
    expect(rec.huella).toMatch(/^[0-9A-F]{64}$/)
  })

  it('chains the second record onto the first', async () => {
    const account = await spanishPartner()
    const first = await invoiceFor(account)
    const second = await invoiceFor(account)

    await record(first.id)
    await record(second.id)

    const recs = await prisma.verifactuRecord.findMany({ orderBy: { chainSeq: 'asc' } })
    expect(recs.map((r) => r.chainSeq)).toEqual([1, 2])
    expect(recs[1]!.huellaPrevious).toBe(recs[0]!.huella)

    const chain = await prisma.verifactuChain.findUniqueOrThrow({ where: { issuerNif: 'B22435705' } })
    expect(chain.lastChainSeq).toBe(2)
    expect(chain.lastHuella).toBe(recs[1]!.huella)
  })

  it('stamps the document type back onto the invoice', async () => {
    // A later rectificativa has to know what it is correcting.
    const account = await spanishPartner()
    const invoice = await invoiceFor(account)
    await record(invoice.id)

    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })
    expect(after.tipoFactura).toBe('F2')
  })

  it('files a credit note as a RECTIFICATIVA, not an anulación', async () => {
    // Getting this wrong is a compliance defect that looks like a feature: an
    // anulación voids a record issued in error, which a refund is not.
    const account = await spanishPartner()
    const receipt = await invoiceFor(account)
    await record(receipt.id)

    const creditNote = await invoiceFor(
      account,
      { creditsInvoiceId: receipt.id, totalCharge: -100, totalTax: -21, totalAmount: -121 },
      [{ charge: -100, tax: -21, amount: -121, vatRate: 21, productCode: 'sunbed-rental' }],
    )
    await record(creditNote.id)

    const rec = await prisma.verifactuRecord.findFirstOrThrow({ where: { invoiceId: creditNote.id } })
    expect(rec.recordType).toBe('ALTA')
    expect(rec.tipoFactura).toBe('R5')        // corrects a simplified invoice
    expect(rec.tipoRectificativa).toBe('I')   // by differences — we carry negatives
  })

  // ── out of scope, and blocked ────────────────────────────────────────────

  it('writes nothing for a non-Spanish issuer', async () => {
    const account = await spanishPartner({ country: 'FI', taxRegion: null, businessId: 'FI12345671' })
    const invoice = await invoiceFor(account, { issuerVatNumber: 'FI12345671' })

    expect(await record(invoice.id)).toEqual({ status: 'out-of-scope' })
    expect(await prisma.verifactuRecord.count()).toBe(0)
  })

  it('writes nothing for a Spanish issuer whose region is unclassified', async () => {
    // Spain with no region resolves to NO regime — the safe direction, since a
    // foral partner filed with the AEAT would go to the wrong authority.
    const account = await spanishPartner({ taxRegion: null })
    const invoice = await invoiceFor(account)
    expect(await record(invoice.id)).toEqual({ status: 'out-of-scope' })
  })

  it('writes nothing for a Basque issuer — TicketBAI, not Veri*factu', async () => {
    const account = await spanishPartner({ taxRegion: 'BI' })
    const invoice = await invoiceFor(account)
    expect(await record(invoice.id)).toEqual({ status: 'out-of-scope' })
  })

  it('BLOCKS rather than files an invoice with a null VAT rate', async () => {
    // Declaring it as 0% would report a zero-rated supply that never happened.
    const account = await spanishPartner()
    const invoice = await invoiceFor(account, {}, [
      { charge: 100, tax: 21, amount: 121, vatRate: null, productCode: 'sunbed-rental' },
    ])

    const outcome = await record(invoice.id)
    expect(outcome.status).toBe('blocked')
    // And leaves NO record: the chain holds filable records in order, so a
    // placeholder would be a hole every later record inherits.
    expect(await prisma.verifactuRecord.count()).toBe(0)
    expect(await prisma.verifactuChain.count()).toBe(0)
  })

  it('BLOCKS an invoice whose issuer has no tax id', async () => {
    const account = await spanishPartner()
    const invoice = await invoiceFor(account, { issuerVatNumber: null })
    expect((await record(invoice.id)).status).toBe('blocked')
    expect(await prisma.verifactuRecord.count()).toBe(0)
  })

  it('BLOCKS a drifted VAT rate of the kind credit notes used to carry', async () => {
    const account = await spanishPartner()
    const invoice = await invoiceFor(account, {}, [
      { charge: 100, tax: 20.98, amount: 120.98, vatRate: 20.98, productCode: 'sunbed-rental' },
    ])
    expect((await record(invoice.id)).status).toBe('blocked')
  })

  it('does not advance the chain when an invoice is blocked', async () => {
    // A blocked invoice between two good ones must not leave a gap in the
    // sequence, or every later record inherits a chain nobody can verify.
    const account = await spanishPartner()
    const good1 = await invoiceFor(account)
    const bad = await invoiceFor(account, {}, [
      { charge: 10, tax: 2, amount: 12, vatRate: null, productCode: 'sunbed-rental' },
    ])
    const good2 = await invoiceFor(account)

    await record(good1.id)
    await record(bad.id)
    await record(good2.id)

    const recs = await prisma.verifactuRecord.findMany({ orderBy: { chainSeq: 'asc' } })
    expect(recs.map((r) => r.chainSeq)).toEqual([1, 2])
    expect(recs[1]!.huellaPrevious).toBe(recs[0]!.huella)
  })

  // ── the wiring, through the real payment path ───────────────────────────

  describe('through processConfirmedReservation', () => {
    /** An ES partner selling one €121 sunbed, with a chosen platform entity. */
    async function sellOneSunbed(opts: {
      partnerCountry: string
      partnerTaxRegion: string | null
      platform: Record<string, unknown>
    }) {
      const user = await createTestUser()
      await createTestPartnerAccount(user.id, {
        company: 'Alonso Beach SL',
        country: opts.partnerCountry,
        taxRegion: opts.partnerTaxRegion,
        // Deliberately NOT the platform's own NIF — the partner and the platform
        // are separate filers on separate chains.
        businessId: 'B29806043',
      })
      const site = await createTestSite(user.id, { vat: 21, price: 121 })
      const settings = await createTestSettings(opts.platform)
      await createTestServiceFee(settings.id)
      const item = await createTestInventoryItem(user.id, site.id, { number: 1 })
      const reservation = await createTestReservation(user.id, site.id, [item.id], {
        paymentAmount: 121,
        status: 'processing',
      })

      await processConfirmedReservation(reservation.id)

      return prisma.invoice.findMany({
        where: { reservationId: reservation.id },
        include: { verifactuRecords: true },
      })
    }

    const SPANISH_PLATFORM = { country: 'ES', vat: 21, vatId: PLATFORM_ES_ISSUER_NIF }

    it('files a record for the PARTNER sale and for OUR commission invoice', async () => {
      // The builder being correct is one thing; being CALLED is another, and
      // this is the only test that proves the seven writers in payment.ts
      // actually invoke it. It caught the wiring sitting BEFORE the invoice
      // lines were written, which blocked every record for having no desglose —
      // something no unit test of the builder can see.
      const invoices = await sellOneSunbed({
        partnerCountry: 'ES',
        partnerTaxRegion: 'MA',
        platform: SPANISH_PLATFORM,
      })

      const partner = invoices.find((i) => i.issuerType === 'PARTNER')
      const platform = invoices.find((i) => i.issuerType === 'PLATFORM')
      expect(partner).toBeDefined()
      expect(platform).toBeDefined()

      expect(partner!.verifactuRecords).toHaveLength(1)
      expect(partner!.verifactuRecords[0]!.recordType).toBe('ALTA')
      // No recipient on a beach sale → a factura simplificada.
      expect(partner!.verifactuRecords[0]!.tipoFactura).toBe('F2')

      // The trap the PLATFORM branch exists for: a PLATFORM invoice's accountId
      // is the RECIPIENT partner, so resolving the regime off it would file our
      // own invoice under the customer's jurisdiction. It is filed under OUR
      // nif, on OUR chain, as an ordinary B2B invoice.
      expect(platform!.verifactuRecords).toHaveLength(1)
      expect(platform!.verifactuRecords[0]!.tipoFactura).toBe('F1')
      expect(platform!.verifactuRecords[0]!.issuerNif).toBe(PLATFORM_ES_ISSUER_NIF)
      expect(partner!.verifactuRecords[0]!.issuerNif).not.toBe(
        platform!.verifactuRecords[0]!.issuerNif,
      )
    })

    it('files nothing for a FINNISH partner going through the same path', async () => {
      const invoices = await sellOneSunbed({
        partnerCountry: 'FI',
        partnerTaxRegion: null,
        platform: SPANISH_PLATFORM,
      })

      const partner = invoices.find((i) => i.issuerType === 'PARTNER')
      expect(partner!.verifactuRecords).toHaveLength(0)
    })

    it('does not file OUR commission invoice when a non-Spanish group entity issued it', async () => {
      // getBusinessEntity() reads a Settings row and there is more than one.
      // A commission invoice issued by the Finnish entity must not be filed to
      // AEAT under a NIF it has never heard of — even though the SALE beneath it
      // is a Spanish partner's and is filed normally.
      const invoices = await sellOneSunbed({
        partnerCountry: 'ES',
        partnerTaxRegion: 'MA',
        platform: { country: 'FI', vat: 25.5, vatId: 'FI99999999' },
      })

      const partner = invoices.find((i) => i.issuerType === 'PARTNER')
      const platform = invoices.find((i) => i.issuerType === 'PLATFORM')
      expect(partner!.verifactuRecords).toHaveLength(1)
      expect(platform).toBeDefined()
      expect(platform!.verifactuRecords).toHaveLength(0)
    })
  })
})
