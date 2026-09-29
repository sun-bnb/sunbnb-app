import { describe, it, expect } from 'vitest'
import {
  computeInvoiceHash,
  deriveSeriesPrefix,
  renderInvoiceNumber,
  INVOICE_HASH_VERSION,
  PLATFORM_SERIES_KEY,
  SERIES_FACTURA,
  SERIES_RECTIFICATIVA,
} from './invoice-series'

// The pure half. The concurrency and chain behaviour that this module exists
// for needs a database and lives in invoice-series.integration.test.ts.

describe('deriveSeriesPrefix', () => {
  it('takes the initials of a company name', () => {
    expect(deriveSeriesPrefix('Alonso Beach')).toBe('AB')
  })

  it('folds accents, so a stem stays in the ASCII range an invoice number needs', () => {
    expect(deriveSeriesPrefix('Hnos. Cortés Perea S.C')).toBe('HCP')
  })

  it('drops legal-form suffixes', () => {
    // Without this every Spanish partner's prefix ends in the same letters, and
    // "Sol y Sabor SL" and "Sol y Sabor SA" would both want SYSS.
    expect(deriveSeriesPrefix('Refactory DX Oy')).toBe('RD')
    expect(deriveSeriesPrefix('Sunbnb España SL')).toBe('SE')
  })

  it('caps the stem so a number does not grow unbounded', () => {
    expect(deriveSeriesPrefix('One Two Three Four Five Six').length).toBeLessThanOrEqual(4)
  })

  it('falls back for a name with nothing usable — a partner must still invoice', () => {
    expect(deriveSeriesPrefix('')).toBe('INV')
    expect(deriveSeriesPrefix(null)).toBe('INV')
    expect(deriveSeriesPrefix('!!! ???')).toBe('INV')
  })
})

describe('renderInvoiceNumber', () => {
  it('renders prefix, series, year and a zero-padded sequence', () => {
    expect(renderInvoiceNumber('AB', SERIES_FACTURA, 2026, 1)).toBe('AB-F-2026-00001')
    expect(renderInvoiceNumber('AB', SERIES_RECTIFICATIVA, 2026, 42)).toBe('AB-R-2026-00042')
  })

  it('keeps the pad width so numbers sort lexicographically', () => {
    const a = renderInvoiceNumber('AB', SERIES_FACTURA, 2026, 9)
    const b = renderInvoiceNumber('AB', SERIES_FACTURA, 2026, 10)
    expect(a < b).toBe(true)
  })
})

describe('computeInvoiceHash', () => {
  const base = {
    seriesKey: 'partner-1',
    invoiceNumber: 'AB-F-2026-00001',
    invoicedAt: new Date('2026-07-01T10:00:00Z'),
    totalAmount: 121,
    issuerVatNumber: 'B22435705',
    previousHash: null as string | null,
  }

  it('is deterministic', () => {
    expect(computeInvoiceHash(base)).toBe(computeInvoiceHash({ ...base }))
  })

  it('is a 64-character sha256 hex digest', () => {
    expect(computeInvoiceHash(base)).toMatch(/^[0-9a-f]{64}$/)
  })

  it.each([
    ['invoiceNumber', { invoiceNumber: 'AB-F-2026-00002' }],
    ['invoicedAt', { invoicedAt: new Date('2026-07-01T10:00:01Z') }],
    ['totalAmount', { totalAmount: 121.01 }],
    ['issuerVatNumber', { issuerVatNumber: 'B99999999' }],
    ['previousHash', { previousHash: 'abc' }],
    // The series key is in the input so a record cannot be lifted out of one
    // issuer's chain into another's and still verify.
    ['seriesKey', { seriesKey: 'partner-2' }],
  ])('changes when %s changes', (_label, patch) => {
    expect(computeInvoiceHash({ ...base, ...patch })).not.toBe(computeInvoiceHash(base))
  })

  it('distinguishes amounts that differ below the rounding it stores', () => {
    // Stored to 2dp, so 121.004 and 121 must NOT be distinguishable — that is
    // the contract, and pinning it stops someone "improving" the precision and
    // silently invalidating every stored hash.
    expect(computeInvoiceHash({ ...base, totalAmount: 121.004 })).toBe(computeInvoiceHash(base))
  })

  it('carries a version, so a future format change is detectable', () => {
    expect(INVOICE_HASH_VERSION).toBe('v2')
  })
})

describe('constants', () => {
  it('keeps the platform series key stable — it is stored on every row', () => {
    expect(PLATFORM_SERIES_KEY).toBe('PLATFORM')
  })

  it('keeps F and R distinct, so a refund never puts a hole in the sales series', () => {
    expect(SERIES_FACTURA).not.toBe(SERIES_RECTIFICATIVA)
  })
})
