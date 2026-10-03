import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
import { buildReservationReceipt } from '../../receipt'
import { getVerifactuHealth, describeVerifactuHealth } from './health'
import { submitPlatformRecords, submitPendingRecords } from './submit'
import { createStubAeatClient } from './client'
import { buildSubmissionXml } from './registro-xml'
import { computeAltaHuella, altaHuellaInputString } from './huella'
import { PLATFORM_ES_ISSUER_NIF } from './sistema-informatico'
import { RECORD_SENT } from './record'
import { verifyInvoiceChain } from '../../invoice-series'

/**
 * The whole pipeline, once, in order (track 026).
 *
 * Every other test in this track checks one seam. This one is the rehearsal: a
 * real Spanish sale goes through `processConfirmedReservation` and comes out the
 * far end as a record AEAT's own schema accepts, a receipt carrying a scannable
 * QR, a chain that verifies, and a register that reports itself complete.
 *
 * It exists because seven phases shipped separately and nothing exercised them
 * together — which is exactly the shape of gap that let a blocked `Desglose` and
 * a silently-restarting chain through.
 *
 * NO CERTIFICATE NEEDED. The only thing this cannot prove is that AEAT's server
 * accepts the document; everything up to the TLS handshake is covered.
 */

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
})
afterAll(async () => {
  await disconnectDatabase()
})

/** A Spanish beach club, properly configured, selling one sunbed for €121. */
async function spanishSale(price = 121) {
  const user = await createTestUser()
  await createTestPartnerAccount(user.id, {
    company: 'Alonso Beach SL',
    country: 'ES',
    taxRegion: 'MA',
    businessId: 'B29806043',
  })
  const site = await createTestSite(user.id, { vat: 21, price, name: 'Alonso Beach' })
  const settings = await createTestSettings({
    country: 'ES',
    vat: 21,
    vatId: PLATFORM_ES_ISSUER_NIF,
    companyName: 'Sunbnb España SL',
  })
  await createTestServiceFee(settings.id)
  const item = await createTestInventoryItem(user.id, site.id, { number: 1 })
  const reservation = await createTestReservation(user.id, site.id, [item.id], {
    paymentAmount: price,
    status: 'processing',
  })
  await processConfirmedReservation(reservation.id)
  return { user, site, reservation }
}

function xmllintAvailable(): boolean {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe('the full Veri*factu lifecycle', () => {
  it('takes a Spanish sale from payment to a filed record, and reports itself complete', async () => {
    const { reservation } = await spanishSale()

    // ── 1. Invoicing: the agent model, gross partner sale + separate commission ──
    const invoices = await prisma.invoice.findMany({
      where: { reservationId: reservation.id },
      include: { verifactuRecords: true, invoiceLines: true },
      orderBy: { issuerType: 'asc' },
    })
    const partner = invoices.find((i) => i.issuerType === 'PARTNER')!
    const platform = invoices.find((i) => i.issuerType === 'PLATFORM')!
    expect(partner.totalAmount).toBe(121)
    // The consumer paid 121; the commission is billed to the PARTNER separately,
    // so these deliberately do not sum to what the guest paid.
    expect(platform.totalAmount).toBeGreaterThan(0)

    // ── 2. Records: one ALTA each, both in scope ──
    expect(partner.verifactuRecords).toHaveLength(1)
    expect(platform.verifactuRecords).toHaveLength(1)
    const partnerRec = partner.verifactuRecords[0]!
    expect(partnerRec.recordType).toBe('ALTA')
    expect(partnerRec.tipoFactura).toBe('F2') // no recipient at a beach bar
    expect(platform.verifactuRecords[0]!.tipoFactura).toBe('F1') // B2B, has recipient

    // Separate issuers, separate chains.
    expect(partnerRec.issuerNif).toBe('B29806043')
    expect(platform.verifactuRecords[0]!.issuerNif).toBe(PLATFORM_ES_ISSUER_NIF)

    // ── 2b. Who issued what, as AEAT needs to be able to tell ──
    // The beach operator is the Seller of Record and we expedite in their name
    // (art. 6 RRSIF / art. 5 ROF), so their record must say so. Our own
    // commission invoice must NOT — there we are the obligado.
    expect(partnerRec.payloadXml).toContain(
      '<sf:EmitidaPorTerceroODestinatario>T</sf:EmitidaPorTerceroODestinatario>',
    )
    expect(partnerRec.payloadXml).toContain('<sf:Tercero>')
    expect(platform.verifactuRecords[0]!.payloadXml).not.toContain(
      'EmitidaPorTerceroODestinatario',
    )
    expect(platform.verifactuRecords[0]!.payloadXml).not.toContain('<sf:Tercero>')

    // ── 3. The huella recomputes from its own stored input ──
    // If this ever fails, the chain is asserting something it cannot prove.
    const stored = JSON.parse(
      JSON.stringify({
        idEmisorFactura: partnerRec.issuerNif,
        numSerieFactura: partnerRec.numSerieFactura,
        fechaExpedicionFactura: partnerRec.fechaExpedicion,
        tipoFactura: partnerRec.tipoFactura,
        cuotaTotal: partnerRec.cuotaTotal,
        importeTotal: partnerRec.importeTotal,
        huellaAnterior: partnerRec.huellaPrevious ?? '',
        fechaHoraHusoGenRegistro: partnerRec.fechaHoraHusoGenRegistro,
      }),
    )
    expect(altaHuellaInputString(stored)).toBe(partnerRec.huellaInput)
    expect(computeAltaHuella(stored)).toBe(partnerRec.huella)

    // ── 4. The invoice hash chain verifies ──
    const chain = await verifyInvoiceChain(partner.seriesKey!)
    expect(chain.ok).toBe(true)

    // ── 5. The guest's receipt carries a scannable QR and the legal literals ──
    const receipt = await buildReservationReceipt(reservation.id)
    expect(receipt.status).toBe('ok')
    if (receipt.status !== 'ok') return
    const fiscal = receipt.receipt.fiscal!
    expect(fiscal).not.toBeNull()
    expect(fiscal.labelAbove).toBe('QR tributario:')
    expect(fiscal.legendBelow).toBe('VERI*FACTU')
    // The QR describes THIS invoice, and carries no CSV — which is what lets the
    // receipt be handed over before AEAT has seen anything.
    const qr = new URL(fiscal.qrUrl)
    expect(qr.searchParams.get('nif')).toBe('B29806043')
    expect(qr.searchParams.get('numserie')).toBe(partner.invoiceNumber)
    expect(qr.searchParams.get('importe')).toBe('121.00')
    expect(qr.searchParams.has('csv')).toBe(false)

    // ── 6. Health BEFORE submission: complete, but a queue is reported ──
    const before = await getVerifactuHealth()
    expect(before.unfiled).toEqual([])
    expect(before.unresolvedEsIssuers).toEqual([])
    expect(before.healthy).toBe(true)
    expect(before.recordsByStatus).toEqual({ pending: 2 })
    expect(describeVerifactuHealth(before)).toContain('2 record(s) awaiting submission')

    // ── 7. Submission: ours goes, the partner's waits for P7a ──
    const client = createStubAeatClient()
    const ours = await submitPlatformRecords({ client })
    expect(ours.accepted).toBe(1)

    const stillQueued = await prisma.verifactuRecord.findFirstOrThrow({
      where: { issuerNif: 'B29806043' },
    })
    expect(stillQueued.status).toBe('pending')

    // ── 8. The partner's record waits for THEIR authorisation (P7a) ──
    // AEAT: "ningún colaborador social realice envíos sin estar previamente
    // autorizado". Without the grant the sweep skips them — it does not fail
    // them, so nothing has to be undone when the grant arrives.
    const ungranted = await submitPendingRecords({ client })
    expect(ungranted.accepted).toBe(0)
    expect(ungranted.issuers.some((i) => i.awaitingAuthorisation)).toBe(true)
    const stillPending = await prisma.verifactuRecord.findFirstOrThrow({
      where: { issuerNif: 'B29806043' },
    })
    expect(stillPending.status).toBe('pending')
    expect(stillPending.attempts).toBe(0)

    // ── 9. Once they authorise, it goes, with nothing else changed ──
    await prisma.partnerAccount.updateMany({
      where: { businessId: 'B29806043' },
      data: { aeatSubmissionGrantedAt: new Date() },
    })
    const all = await submitPendingRecords({ client })
    expect(all.accepted).toBe(1)

    const final = await prisma.verifactuRecord.findMany()
    expect(final.every((r) => r.status === RECORD_SENT)).toBe(true)
    expect(final.every((r) => r.csv !== null)).toBe(true)

    const after = await getVerifactuHealth()
    expect(after.healthy).toBe(true)
    expect(after.oldestUnsentAt).toBeNull()
    expect(describeVerifactuHealth(after)).toBe(
      'Veri*factu register complete; nothing awaiting submission.',
    )
  })

  it('produces documents AEAT’s published schema accepts, from a real sale', async () => {
    // The closest thing to a live submission that needs no certificate: take what
    // the pipeline actually stored and validate it against AEAT's own XSD.
    if (!xmllintAvailable()) {
      console.warn('[lifecycle] xmllint not found — SKIPPING XSD validation')
      return
    }
    await spanishSale()

    const records = await prisma.verifactuRecord.findMany({ orderBy: { chainSeq: 'asc' } })
    expect(records.length).toBeGreaterThan(0)

    // One submission per issuer — a message carries a single ObligadoEmision.
    const byIssuer = new Map<string, string[]>()
    for (const r of records) {
      const list = byIssuer.get(r.issuerNif) ?? []
      list.push(r.payloadXml!)
      byIssuer.set(r.issuerNif, list)
    }
    expect(byIssuer.size).toBe(2)

    for (const [issuerNif, fragments] of byIssuer) {
      const doc = buildSubmissionXml(
        { obligadoEmision: { nombreRazon: 'Test', nif: issuerNif } },
        fragments,
      )
      const dir = mkdtempSync(join(tmpdir(), 'verifactu-lifecycle-'))
      const file = join(dir, 'submission.xml')
      writeFileSync(file, doc)
      execFileSync(
        'xmllint',
        ['--noout', '--schema', resolve(__dirname, 'schemas/SuministroLR.xsd'), file],
        { stdio: 'pipe' },
      )
    }
  })

  it('leaves a non-Spanish sale completely untouched', async () => {
    // The regression that matters for every other market: Veri*factu must be
    // invisible outside Spain.
    const user = await createTestUser()
    await createTestPartnerAccount(user.id, {
      company: 'Refactory DX Oy',
      country: 'FI',
      taxRegion: null,
      businessId: 'FI29409571',
    })
    const site = await createTestSite(user.id, { vat: 25.5, price: 100 })
    const settings = await createTestSettings({ country: 'FI', vat: 25.5 })
    await createTestServiceFee(settings.id)
    const item = await createTestInventoryItem(user.id, site.id, { number: 1 })
    const reservation = await createTestReservation(user.id, site.id, [item.id], {
      paymentAmount: 100,
      status: 'processing',
    })
    await processConfirmedReservation(reservation.id)

    // Invoices exist; records do not.
    const invoices = await prisma.invoice.findMany({ where: { reservationId: reservation.id } })
    expect(invoices.length).toBeGreaterThan(0)
    expect(await prisma.verifactuRecord.count()).toBe(0)

    // And the receipt carries no Spanish furniture.
    const receipt = await buildReservationReceipt(reservation.id)
    if (receipt.status !== 'ok') throw new Error('expected a receipt')
    expect(receipt.receipt.fiscal).toBeNull()

    const health = await getVerifactuHealth()
    expect(health.healthy).toBe(true)
  })
})
