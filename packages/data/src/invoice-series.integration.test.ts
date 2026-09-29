import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import { createTestUser, createTestPartnerAccount, resetCounter } from './test/fixtures'
import {
  allocateInvoiceIdentity,
  ensureSeriesPrefix,
  verifyInvoiceChain,
  SERIES_FACTURA,
  SERIES_RECTIFICATIVA,
} from './invoice-series'

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
})
afterAll(async () => {
  await disconnectDatabase()
})

/** Allocate and write one invoice, the way a payment writer does. */
async function issue(
  seriesKey: string,
  prefix: string,
  opts: { amount?: number; code?: string; at?: Date; vat?: string | null } = {},
) {
  // ONE timestamp and ONE amount, shared by the allocation and the row. Calling
  // `new Date()` twice here silently hashed a different instant than the one
  // stored — which verifyInvoiceChain duly flagged. Real writers have the same
  // hazard, which is why they compute `invoicedAt` once per transaction.
  const invoicedAt = opts.at ?? new Date()
  const amount = opts.amount ?? 100
  const vat = opts.vat ?? 'B22435705'

  return prisma.$transaction(async (tx) => {
    const identity = await allocateInvoiceIdentity(tx, {
      seriesKey,
      seriesCode: opts.code ?? SERIES_FACTURA,
      invoicedAt,
      totalAmount: amount,
      issuerVatNumber: vat,
      prefix,
    })
    return tx.invoice.create({
      data: {
        accountId: seriesKey,
        issuerType: 'PARTNER',
        totalCharge: amount,
        totalTax: 0,
        totalAmount: amount,
        invoicedAt,
        issuerVatNumber: vat,
        ...identity,
      },
    })
  })
}

async function makePartner(company: string) {
  const user = await createTestUser()
  await createTestPartnerAccount(user.id, { company })
  return user.id
}

describe('per-issuer numbering', () => {
  it('gives each issuer its OWN sequence starting at 1', async () => {
    // The defect this phase exists for: one global counter meant partner B's
    // first ever invoice could be numbered 00051 because partner A had sold 50.
    const a = await makePartner('Alonso Beach')
    const b = await makePartner('Bueno Playa')
    const [pa, pb] = await Promise.all([
      prisma.$transaction((tx) => ensureSeriesPrefix(tx, a)),
      prisma.$transaction((tx) => ensureSeriesPrefix(tx, b)),
    ])

    const first = await issue(a, pa)
    const second = await issue(b, pb)

    expect(first.seriesSeq).toBe(1)
    expect(second.seriesSeq).toBe(1)
    expect(first.invoiceNumber).not.toBe(second.invoiceNumber)
  })

  it('increments within one issuer', async () => {
    const a = await makePartner('Alonso Beach')
    const p = await prisma.$transaction((tx) => ensureSeriesPrefix(tx, a))

    const one = await issue(a, p)
    const two = await issue(a, p)

    expect(one.seriesSeq).toBe(1)
    expect(two.seriesSeq).toBe(2)
  })

  it('keeps F and R as independent dense counters', async () => {
    // A refund must not put a hole in the sales sequence.
    const a = await makePartner('Alonso Beach')
    const p = await prisma.$transaction((tx) => ensureSeriesPrefix(tx, a))

    await issue(a, p)
    const credit = await issue(a, p, { code: SERIES_RECTIFICATIVA, amount: -50 })
    const nextSale = await issue(a, p)

    expect(credit.seriesSeq).toBe(1)
    expect(nextSale.seriesSeq).toBe(2)
    expect(credit.invoiceNumber).toMatch(/-R-\d{4}-00001$/)
    expect(nextSale.invoiceNumber).toMatch(/-F-\d{4}-00002$/)
  })

  it('takes the series year from invoicedAt, never from the clock', async () => {
    // Three of the seven writers used to omit the year argument entirely, so a
    // back-dated receipt was numbered into the CURRENT year — a silent hole in
    // the year it belonged to.
    const a = await makePartner('Alonso Beach')
    const p = await prisma.$transaction((tx) => ensureSeriesPrefix(tx, a))

    const backdated = await issue(a, p, { at: new Date('2025-07-01T10:00:00Z') })

    expect(backdated.seriesYear).toBe(2025)
    expect(backdated.invoiceNumber).toContain('-2025-')
  })

  // ── the race that used to charge a card and write no invoice ──────────────

  it('CONCURRENT first invoices for one issuer get 1 and 2, with no throw', async () => {
    // The old allocator read the max with `SELECT … LIMIT 1 FOR UPDATE`, which
    // locks NOTHING when no row matches. Two concurrent openings of an empty
    // series both computed seq 1 and one died on the unique constraint inside
    // the payment transaction. Per-issuer series made that empty case routine.
    const a = await makePartner('Alonso Beach')
    const p = await prisma.$transaction((tx) => ensureSeriesPrefix(tx, a))

    const results = await Promise.allSettled([issue(a, p), issue(a, p)])

    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(0)
    const seqs = await prisma.invoice.findMany({
      where: { seriesKey: a },
      select: { seriesSeq: true },
      orderBy: { seriesSeq: 'asc' },
    })
    expect(seqs.map((s) => s.seriesSeq)).toEqual([1, 2])
  })

  it('concurrent issuers do not block each other', async () => {
    const a = await makePartner('Alonso Beach')
    const b = await makePartner('Bueno Playa')
    const [pa, pb] = await Promise.all([
      prisma.$transaction((tx) => ensureSeriesPrefix(tx, a)),
      prisma.$transaction((tx) => ensureSeriesPrefix(tx, b)),
    ])

    const results = await Promise.allSettled([issue(a, pa), issue(b, pb), issue(a, pa)])
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(0)
    expect(await prisma.invoice.count({ where: { seriesKey: a } })).toBe(2)
    expect(await prisma.invoice.count({ where: { seriesKey: b } })).toBe(1)
  })
})

describe('ensureSeriesPrefix', () => {
  it('assigns once and never changes — the prefix is printed on a document', async () => {
    const a = await makePartner('Alonso Beach')
    const first = await prisma.$transaction((tx) => ensureSeriesPrefix(tx, a))
    const again = await prisma.$transaction((tx) => ensureSeriesPrefix(tx, a))
    expect(again).toBe(first)
  })

  it('disambiguates two partners whose names derive the same stem', async () => {
    // Both would want `AB`. They cannot share it: the rendered number is
    // globally unique, so they would collide on their Nth invoice — inside a
    // payment transaction.
    const a = await makePartner('Alonso Beach')
    const b = await makePartner('Arena Bonita')
    const pa = await prisma.$transaction((tx) => ensureSeriesPrefix(tx, a))
    const pb = await prisma.$transaction((tx) => ensureSeriesPrefix(tx, b))

    expect(pa).toBe('AB')
    expect(pb).toBe('AB2')
  })
})

describe('verifyInvoiceChain', () => {
  it('passes over an intact chain', async () => {
    const a = await makePartner('Alonso Beach')
    const p = await prisma.$transaction((tx) => ensureSeriesPrefix(tx, a))
    for (let i = 0; i < 5; i++) await issue(a, p, { amount: 10 + i })

    const result = await verifyInvoiceChain(a)
    expect(result.checked).toBe(5)
    expect(result.problems).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('links the first record to nothing and each later one to its predecessor', async () => {
    const a = await makePartner('Alonso Beach')
    const p = await prisma.$transaction((tx) => ensureSeriesPrefix(tx, a))
    const one = await issue(a, p)
    const two = await issue(a, p)

    expect(one.previousHash).toBeNull()
    expect(two.previousHash).toBe(one.hash)
  })

  it('DETECTS a tampered amount — the point of storing a hash at all', async () => {
    const a = await makePartner('Alonso Beach')
    const p = await prisma.$transaction((tx) => ensureSeriesPrefix(tx, a))
    await issue(a, p)
    const victim = await issue(a, p, { amount: 100 })
    await issue(a, p)

    // Someone edits a paid invoice directly in the database.
    await prisma.invoice.update({
      where: { id: victim.id },
      data: { totalAmount: 10 },
    })

    const result = await verifyInvoiceChain(a)
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toContain('does not match its contents')
  })

  it('detects a record deleted out of the middle of the chain', async () => {
    const a = await makePartner('Alonso Beach')
    const p = await prisma.$transaction((tx) => ensureSeriesPrefix(tx, a))
    await issue(a, p)
    const victim = await issue(a, p)
    await issue(a, p)

    await prisma.invoice.delete({ where: { id: victim.id } })

    const result = await verifyInvoiceChain(a)
    expect(result.ok).toBe(false)
    expect(result.problems.join(' ')).toContain('previousHash does not match')
  })

  it('reports an issuer with no invoices as trivially intact', async () => {
    const a = await makePartner('Alonso Beach')
    const result = await verifyInvoiceChain(a)
    expect(result).toMatchObject({ ok: true, checked: 0, problems: [] })
  })
})
