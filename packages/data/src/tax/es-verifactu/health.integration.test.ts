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
import {
  getVerifactuHealth,
  describeVerifactuHealth,
  getPartnerGrantStatuses,
} from './health'
import { recordInvoiceForTax, RECORD_BLOCKED, RECORD_SENT } from './record'
import { PLATFORM_ES_ISSUER_NIF, sistemaInformatico } from './sistema-informatico'

let seq = 0

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
  // Reset OUR counter too — `resetCounter` only resets the shared fixtures', and
  // a carried-over value makes invoice numbers depend on test execution order.
  seq = 0
})
afterAll(async () => {
  await disconnectDatabase()
})

// The REAL block, not a hand-built literal: a literal silently went stale when
// the XSD turned out to require three more SistemaInformatico fields.
const SIF = sistemaInformatico({ VERIFACTU_SYSTEM_VERSION: '1.0-test' })

async function partner(overrides: Record<string, unknown> = {}) {
  const user = await createTestUser()
  await createTestPartnerAccount(user.id, {
    company: 'Alonso Beach SL',
    country: 'ES',
    taxRegion: 'MA',
    businessId: 'B29806043',
    ...overrides,
  })
  return user.id
}

async function invoiceFor(accountId: string, data: Record<string, unknown> = {}) {
  seq += 1
  const inv = await prisma.invoice.create({
    data: {
      accountId,
      issuerType: 'PARTNER',
      invoicedAt: new Date('2026-07-10T09:30:00Z'),
      totalCharge: 100,
      totalTax: 21,
      totalAmount: 121,
      issuerVatNumber: 'B29806043',
      // NombreRazonEmisor is mandatory in AEAT's RegistroAlta.
      issuerCompanyName: 'Alonso Beach SL',
      invoiceNumber: `AB-F-2026-${String(seq).padStart(5, '0')}`,
      ...data,
    },
  })
  await prisma.invoiceLine.create({
    data: {
      invoiceId: inv.id,
      charge: 100,
      tax: 21,
      amount: 121,
      vatRate: 21,
      productCode: 'sunbed-rental',
    },
  })
  return inv
}

/** File an invoice the way the writers do. */
async function file(invoiceId: string) {
  return prisma.$transaction((tx) => recordInvoiceForTax(tx, invoiceId, SIF))
}

describe('getVerifactuHealth', () => {
  it('reports a filed Spanish invoice as healthy', async () => {
    const accountId = await partner()
    const inv = await invoiceFor(accountId)
    const outcome = await file(inv.id)
    expect(outcome.status).toBe('created')

    const health = await getVerifactuHealth()
    expect(health.unfiled).toEqual([])
    expect(health.healthy).toBe(true)
    // A queue is not a fault, but it IS reported — AEAT tolerates records sitting
    // "pendientes de remisión", not records abandoned there.
    expect(health.recordsByStatus).toEqual({ pending: 1 })
    expect(describeVerifactuHealth(health)).toBe(
      'Veri*factu register complete; 1 record(s) awaiting submission.',
    )
  })

  it('catches a Spanish invoice that has NO record — the whole point of the module', async () => {
    // Phase 5 writes no record for an invoice it cannot file, on the argument
    // that the absence would be surfaced here. This is that surfacing.
    const accountId = await partner()
    await invoiceFor(accountId)

    const health = await getVerifactuHealth()
    expect(health.unfiled).toHaveLength(1)
    expect(health.unfiled[0]!.issuerType).toBe('PARTNER')
    expect(health.unfiled[0]!.invoiceNumber).toBe('AB-F-2026-00001')
    expect(health.unfiledByIssuerType).toEqual({ PARTNER: 1 })
    expect(health.healthy).toBe(false)
    expect(describeVerifactuHealth(health)).toContain('1 invoice(s) with NO record (1 PARTNER)')
  })

  it('does not flag invoices that owe no record', async () => {
    // Out of scope must not read as a gap, or the alert cries wolf on every
    // Finnish sale and nobody looks at it again.
    const finnish = await partner({ country: 'FI', taxRegion: null })
    await invoiceFor(finnish)
    const foral = await partner({ country: 'ES', taxRegion: 'BI' })
    await invoiceFor(foral)

    const health = await getVerifactuHealth()
    expect(health.unfiled).toEqual([])
    expect(health.unresolvedEsIssuers).toEqual([])
    expect(health.healthy).toBe(true)
  })

  it('refuses to call the register complete when a Spanish issuer has no taxRegion', async () => {
    // The trap this closes, found by running the check against the real TEST
    // database: every figure read clean and the summary said "register
    // complete", when the truth was that no issuer was classified as Spanish at
    // all, so nothing was ever in scope. Same shape as the refunds figure in
    // fiscal.ts that was structurally always 0.00 while EUR 576 had been
    // credited — a number that cannot be wrong because nothing reaches it.
    const unset = await partner({ country: 'ES', taxRegion: null, businessId: 'B11111111' })
    await invoiceFor(unset, { issuerVatNumber: 'B11111111' })
    await invoiceFor(unset, { issuerVatNumber: 'B11111111' })

    const health = await getVerifactuHealth()
    // NOT unfiled: an unclassified issuer never owed a record. That is exactly
    // why it needs its own figure rather than being folded into `unfiled`.
    expect(health.unfiled).toEqual([])
    expect(health.unresolvedEsIssuers).toEqual([
      { issuerNif: 'B11111111', invoiceCount: 2 },
    ])
    expect(health.healthy).toBe(false)
    expect(describeVerifactuHealth(health)).toContain('no taxRegion')
    expect(describeVerifactuHealth(health)).toContain('2 invoice(s) are out of scope')
  })

  it('stops flagging an issuer once its region is set', async () => {
    const accountId = await partner({ country: 'ES', taxRegion: null })
    await invoiceFor(accountId)
    expect((await getVerifactuHealth()).unresolvedEsIssuers).toHaveLength(1)

    await prisma.partnerAccount.update({
      where: { userId: accountId },
      data: { taxRegion: 'MA' },
    })

    const health = await getVerifactuHealth()
    expect(health.unresolvedEsIssuers).toEqual([])
    // Now it is properly in scope — and properly unfiled.
    expect(health.unfiled).toHaveLength(1)
  })

  it('separates OUR unfiled commission invoices from a partner’s sales', async () => {
    // This split is the precondition for switching transmission on: we can file
    // our own invoices without any Convenio, so "can we file ours?" and "can we
    // file theirs?" are different questions with different answers.
    const accountId = await partner()
    await invoiceFor(accountId) // partner sale, unfiled
    await invoiceFor(accountId, {
      issuerType: 'PLATFORM',
      issuerVatNumber: PLATFORM_ES_ISSUER_NIF,
      invoiceNumber: 'PLATFORM-F-2026-00001',
    })

    const health = await getVerifactuHealth()
    expect(health.unfiledByIssuerType).toEqual({ PARTNER: 1, PLATFORM: 1 })
  })

  it('counts our own nameless commission invoices without calling the register unhealthy', async () => {
    // Found on the TEST database: all 8 PLATFORM invoices were unfilable — 7 with
    // a NULL tax id and the name "Platform Operator" (phase 3's placeholder leak)
    // and one carrying a PARTNER's Finnish VAT number. None showed up anywhere,
    // because no issuer id means no jurisdiction means out of scope.
    //
    // Informational rather than unhealthy: it is historical debris cleared by the
    // cutover, and phase 3 already fixed the cause. What matters is that it never
    // grows.
    const accountId = await partner()
    await invoiceFor(accountId, {
      issuerType: 'PLATFORM',
      issuerVatNumber: null,
      issuerCompanyName: 'Platform Operator',
      invoiceNumber: 'PLATFORM-2026-00001',
    })

    const health = await getVerifactuHealth()
    expect(health.platformInvoicesWithoutIssuerId).toBe(1)
    expect(health.unfiled).toEqual([])
    expect(health.healthy).toBe(true)
  })

  it('does not flag a commission invoice issued by a non-Spanish group entity', async () => {
    const accountId = await partner()
    await invoiceFor(accountId, {
      issuerType: 'PLATFORM',
      issuerVatNumber: 'FI99999999',
      invoiceNumber: 'PLATFORM-F-2026-00002',
    })

    const health = await getVerifactuHealth()
    expect(health.unfiled).toEqual([])
  })

  it('treats an ES-prefixed platform tax id as our own entity', async () => {
    // The TEST/production Settings row stores "ESB22435705", with the country
    // prefix. Without folding that off, every one of our own commission invoices
    // would resolve to a different entity and be silently out of scope.
    const accountId = await partner()
    await invoiceFor(accountId, {
      issuerType: 'PLATFORM',
      issuerVatNumber: `ES${PLATFORM_ES_ISSUER_NIF}`,
      invoiceNumber: 'PLATFORM-F-2026-00009',
    })

    const health = await getVerifactuHealth()
    expect(health.unfiledByIssuerType).toEqual({ PLATFORM: 1 })
  })

  it('counts blocked and errored records as unhealthy', async () => {
    const accountId = await partner()
    const inv = await invoiceFor(accountId)
    await file(inv.id)
    await prisma.verifactuRecord.updateMany({ data: { status: RECORD_BLOCKED } })

    const health = await getVerifactuHealth()
    expect(health.recordsByStatus).toEqual({ blocked: 1 })
    expect(health.healthy).toBe(false)
    expect(describeVerifactuHealth(health)).toContain('1 record(s) blocked')
  })

  it('reports the oldest unsent record and ignores sent ones', async () => {
    const accountId = await partner()
    const first = await invoiceFor(accountId)
    await file(first.id)
    const second = await invoiceFor(accountId)
    await file(second.id)

    const all = await getVerifactuHealth()
    expect(all.oldestUnsentAt).not.toBeNull()

    await prisma.verifactuRecord.updateMany({
      data: { status: RECORD_SENT, submittedAt: new Date() },
    })
    const settled = await getVerifactuHealth()
    expect(settled.oldestUnsentAt).toBeNull()
    expect(settled.healthy).toBe(true)
  })

  it('detects a chain that has lost a link', async () => {
    // The hash chain exists to make a deleted record undeniable. chainSeq runs
    // 1..N, so a record count below the chain head means one is gone — and no
    // amount of re-sending repairs that.
    const accountId = await partner()
    const a = await invoiceFor(accountId)
    await file(a.id)
    const b = await invoiceFor(accountId)
    await file(b.id)

    const intact = await getVerifactuHealth()
    expect(intact.chains).toHaveLength(1)
    expect(intact.chains[0]).toMatchObject({ lastChainSeq: 2, recordCount: 2, contiguous: true })

    await prisma.verifactuRecord.deleteMany({ where: { chainSeq: 1 } })

    const broken = await getVerifactuHealth()
    expect(broken.chains[0]).toMatchObject({ lastChainSeq: 2, recordCount: 1, contiguous: false })
    expect(broken.healthy).toBe(false)
    expect(describeVerifactuHealth(broken)).toContain('chain gap')
  })

  it('honours a reporting window for unfiled invoices but not for chains', async () => {
    const accountId = await partner()
    await invoiceFor(accountId, { invoicedAt: new Date('2026-06-15T10:00:00Z') })
    await invoiceFor(accountId, { invoicedAt: new Date('2026-07-15T10:00:00Z') })

    const july = await getVerifactuHealth({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-08-01T00:00:00Z'),
    })
    expect(july.unfiled).toHaveLength(1)

    const allTime = await getVerifactuHealth()
    expect(allTime.unfiled).toHaveLength(2)
  })

  // ── through the real payment path ──

  it('surfaces an invoice the REAL writer refused to file', async () => {
    // The scenario the module exists for, end to end: a Spanish sale whose VAT
    // rate AEAT will not accept. payment.ts logs and carries on — the receipt is
    // the legal obligation and must not fail — so this is the only thing that
    // knows the register is incomplete.
    const user = await createTestUser()
    await createTestPartnerAccount(user.id, {
      company: 'Alonso Beach SL',
      country: 'ES',
      taxRegion: 'MA',
      businessId: 'B29806043',
    })
    // 13% is not a legal Spanish rate, so buildDesglose refuses the invoice.
    const site = await createTestSite(user.id, { vat: 13, price: 113 })
    const settings = await createTestSettings({
      country: 'ES',
      vat: 21,
      vatId: PLATFORM_ES_ISSUER_NIF,
    })
    await createTestServiceFee(settings.id)
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const reservation = await createTestReservation(user.id, site.id, [item.id], {
      paymentAmount: 113,
      status: 'processing',
    })

    await processConfirmedReservation(reservation.id)

    const health = await getVerifactuHealth()
    // The partner sale could not be filed; our commission invoice (21%) could.
    expect(health.unfiledByIssuerType).toEqual({ PARTNER: 1 })
    expect(health.healthy).toBe(false)
    expect(health.unfiled[0]!.issuerNif).toBe('B29806043')
  })
})

// ─── partner authorisations (P7a) ────────────────────────────────────────────

describe('getPartnerGrantStatuses', () => {
  it('reports a Spanish partner with no mandate at all', async () => {
    await partner({ country: 'ES', taxRegion: 'MA', company: 'Alonso Beach SL' })
    const rows = await getPartnerGrantStatuses()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.state).toBe('none')
    expect(rows[0]!.company).toBe('Alonso Beach SL')
  })

  it('distinguishes a half-granted partner from a complete one', async () => {
    // The two authorisations are separate acts, so the half state is real and
    // must not be rounded to yes or no.
    const half = await partner({
      country: 'ES',
      taxRegion: 'MA',
      company: 'Half SL',
      businessId: 'B11111111',
      invoicingAuthorityGrantedAt: new Date(),
    })
    expect(half).toBeTruthy()
    await partner({
      country: 'ES',
      taxRegion: 'CA',
      company: 'Full SL',
      businessId: 'B22222222',
      invoicingAuthorityGrantedAt: new Date(),
      aeatSubmissionGrantedAt: new Date(),
    })

    const rows = await getPartnerGrantStatuses()
    const byCompany = new Map(rows.map((r) => [r.company, r.state]))
    expect(byCompany.get('Half SL')).toBe('invoicing-only')
    expect(byCompany.get('Full SL')).toBe('complete')
  })

  it('counts what the missing grant is actually costing', async () => {
    // A count of held records makes the row actionable: it says what the absent
    // mandate is holding up, not merely that it is absent.
    const accountId = await partner({
      country: 'ES',
      taxRegion: 'MA',
      businessId: 'B29806043',
    })
    await invoiceFor(accountId)
    await file(
      (await prisma.invoice.findFirstOrThrow({ where: { accountId } })).id,
    )

    const rows = await getPartnerGrantStatuses()
    expect(rows[0]!.queuedRecords).toBe(1)
  })

  it('leaves non-Spanish partners out entirely', async () => {
    // Listing a Finnish partner as "not authorised" would invent an obligation.
    await partner({ country: 'FI', taxRegion: null, company: 'Refactory DX Oy' })
    expect(await getPartnerGrantStatuses()).toEqual([])
  })

  it('excludes accounts flagged as test data', async () => {
    await partner({ country: 'ES', taxRegion: 'MA', isTestAccount: true })
    expect(await getPartnerGrantStatuses()).toEqual([])
  })
})
