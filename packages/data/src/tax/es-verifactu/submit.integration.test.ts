import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from '../../test/setup'
import {
  createTestUser,
  createTestPartnerAccount,
  resetCounter,
} from '../../test/fixtures'
import { recordInvoiceForTax, RECORD_BLOCKED, RECORD_ERROR, RECORD_SENT } from './record'
import {
  submitPendingRecords,
  submitPlatformRecords,
  nextAttemptDelayMs,
  MAX_SUBMISSION_ATTEMPTS,
} from './submit'
import {
  createStubAeatClient,
  createAeatHttpClient,
  getAeatClient,
  AeatCertificateMissingError,
} from './client'
import { SoapFaultError } from './soap'
import { PLATFORM_ES_ISSUER_NIF, sistemaInformatico } from './sistema-informatico'

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

/** A record for the PLATFORM issuer, filed through the real writer. */
async function platformRecord(nif = PLATFORM_ES_ISSUER_NIF) {
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
      issuerType: 'PLATFORM',
      invoicedAt: new Date('2026-07-10T09:30:00Z'),
      totalCharge: 100,
      totalTax: 21,
      totalAmount: 121,
      issuerVatNumber: nif,
      issuerCompanyName: 'Sunbnb España SL',
      recipientVatNumber: 'B29806043',
      recipientCompanyName: 'Alonso Beach SL',
      invoiceNumber: `PLATFORM-F-2026-${String(seq).padStart(5, '0')}`,
    },
  })
  await prisma.invoiceLine.create({
    data: {
      invoiceId: inv.id,
      charge: 100,
      tax: 21,
      amount: 121,
      vatRate: 21,
      productCode: 'sunbnb-service-fee',
      description: 'Comisión',
    },
  })
  const outcome = await prisma.$transaction((tx) => recordInvoiceForTax(tx, inv.id, SIF))
  if (outcome.status !== 'created') throw new Error(`expected created, got ${outcome.status}`)
  return inv
}

describe('submitPendingRecords', () => {
  it('submits a pending record and marks it sent with its CSV', async () => {
    await platformRecord()
    const client = createStubAeatClient()

    const result = await submitPendingRecords({ client })
    expect(result.accepted).toBe(1)
    expect(result.rejected).toBe(0)
    expect(client.submissions).toHaveLength(1)
    // What went over the wire is the frozen fragment, inside a real envelope.
    expect(client.submissions[0]).toContain('<sfLR:Cabecera>')
    expect(client.submissions[0]).toContain('<sf:RegistroAlta>')

    const rec = await prisma.verifactuRecord.findFirstOrThrow({})
    expect(rec.status).toBe(RECORD_SENT)
    expect(rec.csv).toBe('STUB-CSV-1')
    expect(rec.submittedAt).not.toBeNull()
    expect(rec.nextAttemptAt).toBeNull()
    expect(rec.attempts).toBe(1)
  })

  it('does not resubmit a record it already sent', async () => {
    await platformRecord()
    const client = createStubAeatClient()
    await submitPendingRecords({ client })
    await submitPendingRecords({ client })
    expect(client.submissions).toHaveLength(1)
  })

  it('keeps AceptadoConErrores as SENT but records the error', async () => {
    // AEAT holds it; the defect still needs surfacing. Retrying would resend
    // something it already has.
    await platformRecord()
    const client = createStubAeatClient({
      replyFor: () => ({
        estado: 'AceptadoConErrores',
        codigoError: 3002,
        descripcionError: 'Huella incorrecta',
      }),
    })

    const result = await submitPendingRecords({ client })
    expect(result.accepted).toBe(1)
    const rec = await prisma.verifactuRecord.findFirstOrThrow({})
    expect(rec.status).toBe(RECORD_SENT)
    expect(rec.lastError).toContain('Aceptado con errores')
    expect(rec.lastError).toContain('3002')
  })

  it('treats a duplicate as sent, so a lost reply is recoverable', async () => {
    await platformRecord()
    const client = createStubAeatClient({
      replyFor: () => ({ estado: 'Incorrecto', duplicado: true }),
    })
    await submitPendingRecords({ client })
    const rec = await prisma.verifactuRecord.findFirstOrThrow({})
    expect(rec.status).toBe(RECORD_SENT)
    expect(rec.lastError).toContain('RegistroDuplicado')
  })

  it('BLOCKS a rejected record instead of retrying the same bytes', async () => {
    await platformRecord()
    const client = createStubAeatClient({
      replyFor: () => ({
        estado: 'Incorrecto',
        codigoError: 1100,
        descripcionError: 'Dato incorrecto',
      }),
    })

    const result = await submitPendingRecords({ client })
    expect(result.rejected).toBe(1)
    const rec = await prisma.verifactuRecord.findFirstOrThrow({})
    expect(rec.status).toBe(RECORD_BLOCKED)
    expect(rec.nextAttemptAt).toBeNull()
    expect(rec.lastError).toContain('1100')

    // And it is not picked up again.
    await submitPendingRecords({ client })
    expect(client.submissions).toHaveLength(1)
  })

  // ── chain order ──

  it('STOPS at the first rejection, leaving later records for the next sweep', async () => {
    // Head-of-line blocking is correct here: records within a chain must reach
    // AEAT in order, so skipping past a stuck one is a compliance breach rather
    // than a throughput win.
    const first = await platformRecord()
    await platformRecord()
    await platformRecord()

    const client = createStubAeatClient({
      replyFor: (num) =>
        num === first.invoiceNumber
          ? { estado: 'Incorrecto', codigoError: 1100 }
          : { estado: 'Correcto' },
    })

    const result = await submitPendingRecords({ client })
    expect(result.rejected).toBe(1)
    expect(result.accepted).toBe(0)
    expect(result.issuers[0]!.haltedForChainOrder).toBe(true)

    const records = await prisma.verifactuRecord.findMany({ orderBy: { chainSeq: 'asc' } })
    expect(records[0]!.status).toBe(RECORD_BLOCKED)
    // The later ones were NOT marked sent even though the stub accepted them.
    expect(records[1]!.status).toBe(RECORD_ERROR)
    expect(records[2]!.status).toBe(RECORD_ERROR)
    expect(records[1]!.lastError).toContain('Earlier record in the chain')
  })

  it('requeues with backoff when the transport fails, and does not lose the record', async () => {
    await platformRecord()
    const now = new Date('2026-07-10T12:00:00Z')
    const client = createStubAeatClient({ failWith: new Error('socket hang up') })

    await submitPendingRecords({ client, now })
    const rec = await prisma.verifactuRecord.findFirstOrThrow({})
    expect(rec.status).toBe(RECORD_ERROR)
    expect(rec.attempts).toBe(1)
    expect(rec.lastError).toContain('socket hang up')
    // Queued for later, not abandoned: AEAT prescribes exactly this for an
    // incident, and "no pueden quedar RF generados sin remitir".
    expect(rec.nextAttemptAt).toEqual(new Date(now.getTime() + nextAttemptDelayMs(1)))
  })

  it('does not pick up a record whose backoff has not elapsed', async () => {
    await platformRecord()
    const t0 = new Date('2026-07-10T12:00:00Z')
    const failing = createStubAeatClient({ failWith: new Error('down') })
    await submitPendingRecords({ client: failing, now: t0 })

    const tooSoon = createStubAeatClient()
    await submitPendingRecords({ client: tooSoon, now: new Date(t0.getTime() + 30_000) })
    expect(tooSoon.submissions).toHaveLength(0)

    const later = createStubAeatClient()
    await submitPendingRecords({ client: later, now: new Date(t0.getTime() + 10 * 60_000) })
    expect(later.submissions).toHaveLength(1)
  })

  it('BLOCKS the batch on a SOAP Fault, because retrying cannot fix it', async () => {
    // 4112 arrives this way — the certificate is not entitled to act for this
    // obligado. No amount of retrying changes that.
    await platformRecord()
    const client = createStubAeatClient({
      failWith: new SoapFaultError('4112 El titular del certificado...', 'env:Client'),
    })

    const result = await submitPendingRecords({ client })
    expect(result.issuers[0]!.error).toContain('4112')
    const rec = await prisma.verifactuRecord.findFirstOrThrow({})
    expect(rec.status).toBe(RECORD_BLOCKED)
    expect(rec.nextAttemptAt).toBeNull()
  })

  it('gives up after the attempt ceiling rather than retrying forever', async () => {
    // The thing /api/reconcile lacks: a terminal state. A row that can never
    // succeed must stop consuming sweeps and start being visible.
    await platformRecord()
    await prisma.verifactuRecord.updateMany({
      data: { attempts: MAX_SUBMISSION_ATTEMPTS - 1 },
    })
    const client = createStubAeatClient({ failWith: new Error('still down') })

    await submitPendingRecords({ client, now: new Date('2026-07-10T12:00:00Z') })
    const rec = await prisma.verifactuRecord.findFirstOrThrow({})
    expect(rec.attempts).toBe(MAX_SUBMISSION_ATTEMPTS)
    expect(rec.status).toBe(RECORD_BLOCKED)
    expect(rec.nextAttemptAt).toBeNull()
  })

  it('requeues rather than assuming success when a reply omits a record', async () => {
    await platformRecord()
    const client = createStubAeatClient({ replyFor: () => ({ estado: 'Correcto' }) })
    // Force a reply that mentions nothing by submitting, then faking an empty
    // line set via a client that returns no lines at all.
    const emptyReply = {
      ...client,
      submit: async () => ({
        estadoEnvio: 'Correcto' as const,
        csv: 'X',
        tiempoEsperaEnvioSeconds: 60,
        lines: [],
      }),
    }
    await submitPendingRecords({ client: emptyReply })
    const rec = await prisma.verifactuRecord.findFirstOrThrow({})
    expect(rec.status).toBe(RECORD_ERROR)
    expect(rec.lastError).toContain('no line for this record')
  })
})

describe('submitPlatformRecords', () => {
  it('submits OUR records and leaves a partner’s queued', async () => {
    // The P7.1 scope. We are the Obligado Emisión on our own commission invoices,
    // so they need no Convenio; a partner's stay queued until P7a.
    await platformRecord()

    const user = await createTestUser()
    await createTestPartnerAccount(user.id, {
      company: 'Alonso Beach SL',
      country: 'ES',
      taxRegion: 'MA',
      businessId: 'B29806043',
    })
    const partnerInv = await prisma.invoice.create({
      data: {
        accountId: user.id,
        issuerType: 'PARTNER',
        invoicedAt: new Date('2026-07-11T09:30:00Z'),
        totalCharge: 100,
        totalTax: 21,
        totalAmount: 121,
        issuerVatNumber: 'B29806043',
        issuerCompanyName: 'Alonso Beach SL',
        invoiceNumber: 'AB-F-2026-00001',
      },
    })
    await prisma.invoiceLine.create({
      data: {
        invoiceId: partnerInv.id,
        charge: 100,
        tax: 21,
        amount: 121,
        vatRate: 21,
        productCode: 'sunbed-rental',
        description: 'Hamaca',
      },
    })
    await prisma.$transaction((tx) => recordInvoiceForTax(tx, partnerInv.id, SIF))

    const client = createStubAeatClient()
    const result = await submitPlatformRecords({ client })
    expect(result.accepted).toBe(1)

    const ours = await prisma.verifactuRecord.findFirstOrThrow({
      where: { issuerNif: PLATFORM_ES_ISSUER_NIF },
    })
    expect(ours.status).toBe(RECORD_SENT)
    const theirs = await prisma.verifactuRecord.findFirstOrThrow({
      where: { issuerNif: 'B29806043' },
    })
    // Queued, which is the correct state and not a failure.
    expect(theirs.status).toBe('pending')
    expect(theirs.attempts).toBe(0)
  })

  it('finds our records when the NIF is stored with its ES prefix', async () => {
    // The platform Settings row in test and production stores "ESB22435705". A
    // filter on the bare form alone matches nothing and reports a clean empty run.
    await platformRecord(`ES${PLATFORM_ES_ISSUER_NIF}`)
    const client = createStubAeatClient()
    const result = await submitPlatformRecords({ client })
    expect(result.accepted).toBe(1)
  })
})

describe('the client mode switch', () => {
  it('defaults to the stub when no certificate is configured', () => {
    expect(getAeatClient({} as NodeJS.ProcessEnv).mode).toBe('stub')
  })

  it('uses the real client when a certificate is present', () => {
    const c = getAeatClient({
      AEAT_CERT_PFX_BASE64: Buffer.from('not-a-real-pfx').toString('base64'),
    } as NodeJS.ProcessEnv)
    expect(c.mode).toBe('http')
  })

  it('FAILS CLOSED in explicit http mode with no certificate', () => {
    // Never silently degrade: falling back to a stub would mark every record sent
    // while AEAT held nothing, and the register would read complete.
    expect(() => createAeatHttpClient({ AEAT_MODE: 'http' } as NodeJS.ProcessEnv)).toThrow(
      AeatCertificateMissingError,
    )
    expect(() => getAeatClient({ AEAT_MODE: 'http' } as NodeJS.ProcessEnv)).toThrow(
      AeatCertificateMissingError,
    )
  })

  it('defaults to the pruebas endpoint, never production', () => {
    // A wrong guess toward the sandbox costs a re-run; a wrong guess toward
    // production files real records from a dev machine.
    const c = getAeatClient({
      AEAT_CERT_PFX_BASE64: Buffer.from('x').toString('base64'),
    } as NodeJS.ProcessEnv)
    expect(c.environment).toBe('pruebas')
    expect(c.endpoint).toContain('prewww1.aeat.es')

    const prod = getAeatClient({
      AEAT_CERT_PFX_BASE64: Buffer.from('x').toString('base64'),
      AEAT_ENV: 'production',
    } as NodeJS.ProcessEnv)
    expect(prod.endpoint).toContain('www1.agenciatributaria.gob.es')
    // Not the ...Sello port: we hold a representative certificate.
    expect(prod.endpoint).not.toContain('www10')
  })
})
