import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { cleanDatabase, disconnectDatabase, prisma } from '../../test/setup'
import { createTestUser, createTestPartnerAccount, resetCounter } from '../../test/fixtures'
import { recordInvoiceForTax, RECORD_SENT, RECORD_BLOCKED } from './record'
import { planAnulacion, anularInvoice } from './anulacion'
import { buildSubmissionXml } from './registro-xml'
import { anulacionHuellaInputString, computeAnulacionHuella } from './huella'
import { sistemaInformatico } from './sistema-informatico'

const SIF = sistemaInformatico({ VERIFACTU_SYSTEM_VERSION: '1.0-test' })
let seq = 0

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
  seq = 0
})
afterAll(async () => {
  await disconnectDatabase()
})

async function filedInvoice() {
  seq += 1
  const user = await createTestUser()
  await createTestPartnerAccount(user.id, {
    company: 'Alonso Beach SL',
    country: 'ES',
    taxRegion: 'MA',
    businessId: 'B29806043',
  })
  const inv = await prisma.invoice.create({
    data: {
      accountId: user.id,
      issuerType: 'PARTNER',
      invoicedAt: new Date('2026-07-10T09:30:00Z'),
      totalCharge: 100,
      totalTax: 21,
      totalAmount: 121,
      issuerVatNumber: 'B29806043',
      issuerCompanyName: 'Alonso Beach SL',
      invoiceNumber: `AB-F-2026-${String(seq).padStart(5, '0')}`,
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
      description: 'Hamaca',
    },
  })
  const outcome = await prisma.$transaction((tx) => recordInvoiceForTax(tx, inv.id, SIF))
  if (outcome.status !== 'created') throw new Error(`expected created, got ${outcome.status}`)
  return inv
}

// ─── the 2x2, without a database ─────────────────────────────────────────────

describe('planAnulacion', () => {
  it('sets no flags when AEAT holds the record and this is the first attempt', () => {
    expect(planAnulacion([{ status: 'sent', recordType: 'ALTA' }])).toEqual({
      sinRegistroPrevio: null,
      rechazoPrevio: null,
    })
  })

  it('sets SinRegistroPrevio when AEAT never accepted anything', () => {
    expect(planAnulacion([{ status: 'pending', recordType: 'ALTA' }])).toEqual({
      sinRegistroPrevio: 'S',
      rechazoPrevio: null,
    })
    expect(planAnulacion([{ status: 'blocked', recordType: 'ALTA' }])).toEqual({
      sinRegistroPrevio: 'S',
      rechazoPrevio: null,
    })
  })

  it('sets RechazoPrevio when an earlier annulment was rejected', () => {
    expect(
      planAnulacion([
        { status: 'blocked', recordType: 'ANULACION' },
        { status: 'sent', recordType: 'ALTA' },
      ]),
    ).toEqual({ sinRegistroPrevio: null, rechazoPrevio: 'S' })
  })

  it('sets BOTH when neither the alta nor the earlier annulment reached AEAT', () => {
    // All four combinations are legal — these are independent axes, not
    // alternatives. AEAT calls this one "ANULACIÓN POR RECHAZO SIN REGISTRO PREVIO".
    expect(
      planAnulacion([
        { status: 'blocked', recordType: 'ANULACION' },
        { status: 'blocked', recordType: 'ALTA' },
      ]),
    ).toEqual({ sinRegistroPrevio: 'S', rechazoPrevio: 'S' })
  })

  it('counts an AceptadoConErrores alta as held by AEAT', () => {
    // It is recorded as `sent` precisely because AEAT kept it.
    expect(planAnulacion([{ status: 'sent', recordType: 'ALTA' }]).sinRegistroPrevio).toBeNull()
  })
})

// ─── filing one ──────────────────────────────────────────────────────────────

describe('anularInvoice', () => {
  it('voids a filed record, joining the same chain', async () => {
    const inv = await filedInvoice()
    await prisma.verifactuRecord.updateMany({
      where: { invoiceId: inv.id },
      data: { status: RECORD_SENT, csv: 'CSV-1' },
    })

    const result = await prisma.$transaction((tx) => anularInvoice(tx, inv.id, SIF))
    expect(result.status).toBe('created')
    if (result.status !== 'created') return
    expect(result.plan).toEqual({ sinRegistroPrevio: null, rechazoPrevio: null })

    const records = await prisma.verifactuRecord.findMany({
      where: { invoiceId: inv.id },
      orderBy: { chainSeq: 'asc' },
    })
    expect(records).toHaveLength(2)
    const anulacion = records[1]!
    expect(anulacion.recordType).toBe('ANULACION')
    expect(anulacion.status).toBe('pending')
    // Chained onto the alta — an annulment is a record like any other, which is
    // exactly why Invoice.hash could never have served as this chain.
    expect(anulacion.chainSeq).toBe(records[0]!.chainSeq + 1)
    expect(anulacion.huellaPrevious).toBe(records[0]!.huella)

    // No amounts, no document type: an annulment asserts nothing about money.
    expect(anulacion.tipoFactura).toBe('')
    expect(anulacion.payloadXml).toContain('<sf:RegistroAnulacion>')
    expect(anulacion.payloadXml).not.toContain('Desglose')
    expect(anulacion.payloadXml).not.toContain('ImporteTotal')
    // The annulled invoice is named with the ...Anulada element names.
    expect(anulacion.payloadXml).toContain('<sf:NumSerieFacturaAnulada>')
    expect(anulacion.payloadXml).toContain(inv.invoiceNumber!)
  })

  it('recomputes its huella from its own stored input', async () => {
    const inv = await filedInvoice()
    await prisma.verifactuRecord.updateMany({
      where: { invoiceId: inv.id },
      data: { status: RECORD_SENT },
    })
    await prisma.$transaction((tx) => anularInvoice(tx, inv.id, SIF))

    const anulacion = await prisma.verifactuRecord.findFirstOrThrow({
      where: { invoiceId: inv.id, recordType: 'ANULACION' },
    })
    // The anulación huella covers a DIFFERENT field set from an alta's.
    const input = {
      idEmisorFacturaAnulada: anulacion.issuerNif,
      numSerieFacturaAnulada: anulacion.numSerieFactura,
      fechaExpedicionFacturaAnulada: anulacion.fechaExpedicion,
      huellaAnterior: anulacion.huellaPrevious ?? '',
      fechaHoraHusoGenRegistro: anulacion.fechaHoraHusoGenRegistro,
    }
    expect(anulacionHuellaInputString(input)).toBe(anulacion.huellaInput)
    expect(computeAnulacionHuella(input)).toBe(anulacion.huella)
  })

  it('marks SinRegistroPrevio when the alta never reached AEAT', async () => {
    const inv = await filedInvoice() // record stays `pending`
    const result = await prisma.$transaction((tx) => anularInvoice(tx, inv.id, SIF))
    expect(result.status).toBe('created')
    if (result.status !== 'created') return
    expect(result.plan.sinRegistroPrevio).toBe('S')

    const anulacion = await prisma.verifactuRecord.findFirstOrThrow({
      where: { invoiceId: inv.id, recordType: 'ANULACION' },
    })
    expect(anulacion.payloadXml).toContain('<sf:SinRegistroPrevio>S</sf:SinRegistroPrevio>')
  })

  it('refuses when AEAT already accepted an annulment', async () => {
    const inv = await filedInvoice()
    await prisma.verifactuRecord.updateMany({
      where: { invoiceId: inv.id },
      data: { status: RECORD_SENT },
    })
    await prisma.$transaction((tx) => anularInvoice(tx, inv.id, SIF))
    await prisma.verifactuRecord.updateMany({
      where: { invoiceId: inv.id, recordType: 'ANULACION' },
      data: { status: RECORD_SENT },
    })

    const again = await prisma.$transaction((tx) => anularInvoice(tx, inv.id, SIF))
    expect(again.status).toBe('already-annulled')
  })

  it('retries a REJECTED annulment with RechazoPrevio=S', async () => {
    const inv = await filedInvoice()
    await prisma.verifactuRecord.updateMany({
      where: { invoiceId: inv.id },
      data: { status: RECORD_SENT },
    })
    await prisma.$transaction((tx) => anularInvoice(tx, inv.id, SIF))
    await prisma.verifactuRecord.updateMany({
      where: { invoiceId: inv.id, recordType: 'ANULACION' },
      data: { status: RECORD_BLOCKED, lastError: 'Rejected' },
    })
    // The unique [invoiceId, recordType] caps ANULACION at one, same as
    // SUBSANACION — so a retry needs the row replaced, not added.
    await prisma.verifactuRecord.deleteMany({
      where: { invoiceId: inv.id, recordType: 'ANULACION' },
    })

    const plan = planAnulacion([
      { status: 'blocked', recordType: 'ANULACION' },
      { status: 'sent', recordType: 'ALTA' },
    ])
    expect(plan.rechazoPrevio).toBe('S')
  })

  it('refuses an invoice that was never filed at all', async () => {
    const inv = await filedInvoice()
    await prisma.verifactuRecord.deleteMany({ where: { invoiceId: inv.id } })
    // Nothing was filed, so there is nothing to void — annulling anyway would
    // assert to AEAT that a record existed.
    const result = await prisma.$transaction((tx) => anularInvoice(tx, inv.id, SIF))
    expect(result.status).toBe('not-found')
  })

  it('does nothing for a non-Spanish issuer', async () => {
    const user = await createTestUser()
    await createTestPartnerAccount(user.id, {
      country: 'FI',
      taxRegion: null,
      businessId: 'FI29409571',
    })
    const inv = await prisma.invoice.create({
      data: {
        accountId: user.id,
        issuerType: 'PARTNER',
        invoicedAt: new Date('2026-07-10T09:30:00Z'),
        totalCharge: 100,
        totalTax: 25.5,
        totalAmount: 125.5,
        issuerVatNumber: 'FI29409571',
        issuerCompanyName: 'Refactory DX Oy',
        invoiceNumber: 'FI-F-2026-00001',
      },
    })
    const result = await prisma.$transaction((tx) => anularInvoice(tx, inv.id, SIF))
    expect(result.status).toBe('out-of-scope')
  })
})

// ─── schema validity ─────────────────────────────────────────────────────────

describe('against AEAT’s published XSD', () => {
  function xmllintAvailable(): boolean {
    try {
      execFileSync('xmllint', ['--version'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }

  it('validates a submission mixing an alta and an anulación', async () => {
    if (!xmllintAvailable()) {
      console.warn('[anulacion] xmllint not found — SKIPPING XSD validation')
      return
    }
    // RegistroAlta and RegistroAnulacion are a <choice> inside RegistroFactura,
    // so one message may carry both — and the anulación has its own element
    // order and its own ...Anulada identity names.
    const inv = await filedInvoice()
    await prisma.verifactuRecord.updateMany({
      where: { invoiceId: inv.id },
      data: { status: RECORD_SENT },
    })
    await prisma.$transaction((tx) => anularInvoice(tx, inv.id, SIF))

    const records = await prisma.verifactuRecord.findMany({ orderBy: { chainSeq: 'asc' } })
    expect(records).toHaveLength(2)
    const doc = buildSubmissionXml(
      { obligadoEmision: { nombreRazon: 'Alonso Beach SL', nif: 'B29806043' } },
      records.map((r) => r.payloadXml!),
    )
    const dir = mkdtempSync(join(tmpdir(), 'verifactu-anul-'))
    const file = join(dir, 'submission.xml')
    writeFileSync(file, doc)
    execFileSync(
      'xmllint',
      ['--noout', '--schema', resolve(__dirname, 'schemas/SuministroLR.xsd'), file],
      { stdio: 'pipe' },
    )
  })
})
