import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { cleanDatabase, disconnectDatabase, prisma } from '../../test/setup'
import { createTestUser, createTestPartnerAccount, resetCounter } from '../../test/fixtures'
import { recordInvoiceForTax, RECORD_SENT, RECORD_BLOCKED } from './record'
import {
  planSubsanacion,
  subsanarInvoice,
  findRecordsNeedingSubsanacion,
} from './subsanacion'
import { buildSubmissionXml } from './registro-xml'
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

async function spanishInvoice() {
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

// ─── the case mapping, without a database ────────────────────────────────────

describe('planSubsanacion', () => {
  it('treats a SENT record as held by AEAT — no RechazoPrevio', () => {
    // Including AceptadoConErrores, which the sweep records as sent precisely
    // because AEAT kept it.
    expect(planSubsanacion({ status: 'sent', recordType: 'ALTA', csv: 'X' })).toEqual({
      case: 'held-by-aeat',
      subsanacion: 'S',
      rechazoPrevio: null,
    })
  })

  it('treats a blocked original as NOT at AEAT — RechazoPrevio=X', () => {
    expect(planSubsanacion({ status: 'blocked', recordType: 'ALTA', csv: null })).toEqual({
      case: 'not-at-aeat',
      subsanacion: 'S',
      rechazoPrevio: 'X',
    })
  })

  it('distinguishes a rejected CORRECTION — RechazoPrevio=S, not X', () => {
    // The subtle one: such a record is both a SUBSANACION and not-at-AEAT, and
    // only the S branch is correct. X would claim the ORIGINAL was never filed.
    expect(planSubsanacion({ status: 'blocked', recordType: 'SUBSANACION', csv: null })).toEqual({
      case: 'previous-subsanacion-rejected',
      subsanacion: 'S',
      rechazoPrevio: 'S',
    })
  })
})

// ─── filing one ──────────────────────────────────────────────────────────────

describe('subsanarInvoice', () => {
  it('corrects a record AEAT accepted WITH ERRORS — the gap this closes', async () => {
    const inv = await spanishInvoice()
    // Exactly what the sweep writes on AceptadoConErrores: sent, with the defect
    // preserved. Before this module, nothing could act on it.
    await prisma.verifactuRecord.updateMany({
      where: { invoiceId: inv.id },
      data: {
        status: RECORD_SENT,
        csv: 'CSV-123',
        lastError: 'Aceptado con errores (3002): Huella incorrecta',
      },
    })

    const result = await prisma.$transaction((tx) => subsanarInvoice(tx, inv.id, SIF))
    expect(result.status).toBe('created')
    if (result.status !== 'created') return
    expect(result.case).toBe('held-by-aeat')

    const records = await prisma.verifactuRecord.findMany({
      where: { invoiceId: inv.id },
      orderBy: { chainSeq: 'asc' },
    })
    expect(records).toHaveLength(2)
    const correction = records[1]!
    expect(correction.recordType).toBe('SUBSANACION')
    expect(correction.status).toBe('pending') // the sweep will pick it up
    // Same invoice identity — that is what makes it a correction and not a new sale.
    expect(correction.numSerieFactura).toBe(records[0]!.numSerieFactura)
    // New position in the chain, chained onto the original.
    expect(correction.chainSeq).toBe(records[0]!.chainSeq + 1)
    expect(correction.huellaPrevious).toBe(records[0]!.huella)
    expect(correction.huella).not.toBe(records[0]!.huella)

    expect(correction.payloadXml).toContain('<sf:Subsanacion>S</sf:Subsanacion>')
    expect(correction.payloadXml).not.toContain('RechazoPrevio')
  })

  it('marks RechazoPrevio=X when AEAT never held the record', async () => {
    const inv = await spanishInvoice()
    await prisma.verifactuRecord.updateMany({
      where: { invoiceId: inv.id },
      data: { status: RECORD_BLOCKED, lastError: 'Rejected (1100): Dato incorrecto' },
    })

    const result = await prisma.$transaction((tx) => subsanarInvoice(tx, inv.id, SIF))
    expect(result.status).toBe('created')
    if (result.status !== 'created') return
    expect(result.case).toBe('not-at-aeat')

    const correction = await prisma.verifactuRecord.findFirstOrThrow({
      where: { invoiceId: inv.id, recordType: 'SUBSANACION' },
    })
    expect(correction.payloadXml).toContain('<sf:Subsanacion>S</sf:Subsanacion>')
    expect(correction.payloadXml).toContain('<sf:RechazoPrevio>X</sf:RechazoPrevio>')
  })

  it('refuses to correct the same invoice twice, for now', async () => {
    // Documented limit: the [invoiceId, recordType] unique caps SUBSANACION at
    // one. Reported explicitly rather than surfacing as a constraint violation.
    const inv = await spanishInvoice()
    await prisma.verifactuRecord.updateMany({
      where: { invoiceId: inv.id },
      data: { status: RECORD_SENT, lastError: 'Aceptado con errores' },
    })
    await prisma.$transaction((tx) => subsanarInvoice(tx, inv.id, SIF))

    const second = await prisma.$transaction((tx) => subsanarInvoice(tx, inv.id, SIF))
    expect(second.status).toBe('already-corrected')
  })

  it('reports not-found for an invoice that was never filed', async () => {
    const inv = await spanishInvoice()
    await prisma.verifactuRecord.deleteMany({ where: { invoiceId: inv.id } })
    const result = await prisma.$transaction((tx) => subsanarInvoice(tx, inv.id, SIF))
    expect(result.status).toBe('not-found')
  })
})

// ─── surfacing candidates ────────────────────────────────────────────────────

describe('findRecordsNeedingSubsanacion', () => {
  it('surfaces accepted-with-errors records, which look fine everywhere else', async () => {
    const good = await spanishInvoice()
    await prisma.verifactuRecord.updateMany({
      where: { invoiceId: good.id },
      data: { status: RECORD_SENT, csv: 'CSV-OK' },
    })
    const flawed = await spanishInvoice()
    await prisma.verifactuRecord.updateMany({
      where: { invoiceId: flawed.id },
      data: {
        status: RECORD_SENT,
        csv: 'CSV-2',
        lastError: 'Aceptado con errores (3002): Huella incorrecta',
      },
    })

    const candidates = await findRecordsNeedingSubsanacion()
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.invoiceId).toBe(flawed.id)
    expect(candidates[0]!.lastError).toContain('3002')
  })
})

// ─── the corrected document is still schema-valid ────────────────────────────

describe('against AEAT’s published XSD', () => {
  function xmllintAvailable(): boolean {
    try {
      execFileSync('xmllint', ['--version'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }

  it('validates a subsanación document', async () => {
    if (!xmllintAvailable()) {
      console.warn('[subsanacion] xmllint not found — SKIPPING XSD validation')
      return
    }
    // Subsanacion and RechazoPrevio sit between NombreRazonEmisor and
    // TipoFactura in the sequence; putting them anywhere else is invalid, and
    // only the schema can tell us.
    const inv = await spanishInvoice()
    await prisma.verifactuRecord.updateMany({
      where: { invoiceId: inv.id },
      data: { status: RECORD_BLOCKED, lastError: 'Rejected' },
    })
    await prisma.$transaction((tx) => subsanarInvoice(tx, inv.id, SIF))

    const records = await prisma.verifactuRecord.findMany({ orderBy: { chainSeq: 'asc' } })
    const doc = buildSubmissionXml(
      { obligadoEmision: { nombreRazon: 'Alonso Beach SL', nif: 'B29806043' } },
      records.map((r) => r.payloadXml!),
    )
    const dir = mkdtempSync(join(tmpdir(), 'verifactu-subs-'))
    const file = join(dir, 'submission.xml')
    writeFileSync(file, doc)
    execFileSync(
      'xmllint',
      ['--noout', '--schema', resolve(__dirname, 'schemas/SuministroLR.xsd'), file],
      { stdio: 'pipe' },
    )
  })
})
