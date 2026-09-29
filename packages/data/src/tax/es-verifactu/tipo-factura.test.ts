import { describe, it, expect } from 'vitest'
import {
  buildDesglose,
  classifyTipoFactura,
  isLegalEsVatRate,
  SIMPLIFIED_INVOICE_CEILING,
} from './tipo-factura'

describe('classifyTipoFactura', () => {
  it('classifies a consumer receipt as a simplified invoice', () => {
    // No recipient is collected at a beach bar, and the amounts are tiny.
    expect(classifyTipoFactura({ totalAmount: 121, hasRecipient: false, creditsInvoice: false }))
      .toEqual({ ok: true, tipoFactura: 'F2' })
  })

  it('classifies the commission invoice as a full invoice', () => {
    // It carries the partner's tax id as recipient — an ordinary B2B document.
    expect(classifyTipoFactura({ totalAmount: 7.26, hasRecipient: true, creditsInvoice: false }))
      .toEqual({ ok: true, tipoFactura: 'F1' })
  })

  it('classifies a credit note against a simplified invoice as R5', () => {
    expect(
      classifyTipoFactura({
        totalAmount: -121,
        hasRecipient: false,
        creditsInvoice: true,
        creditedTipoFactura: 'F2',
      }),
    ).toEqual({ ok: true, tipoFactura: 'R5' })
  })

  it('classifies a credit note against a full invoice as R1', () => {
    expect(
      classifyTipoFactura({
        totalAmount: -7.26,
        hasRecipient: true,
        creditsInvoice: true,
        creditedTipoFactura: 'F1',
      }),
    ).toEqual({ ok: true, tipoFactura: 'R1' })
  })

  it('REFUSES a credit note whose original is unknown', () => {
    // A rectificativa follows what it corrects. Guessing would file the wrong
    // document type against a real sale.
    const r = classifyTipoFactura({
      totalAmount: -50,
      hasRecipient: false,
      creditsInvoice: true,
      creditedTipoFactura: null,
    })
    expect(r.ok).toBe(false)
  })

  it('REFUSES a recipient-less sale above the simplified ceiling', () => {
    // It can be neither F2 (over the limit) nor F1 (no recipient details were
    // ever collected). Surfacing that is the only honest option.
    const r = classifyTipoFactura({
      totalAmount: SIMPLIFIED_INVOICE_CEILING + 0.01,
      hasRecipient: false,
      creditsInvoice: false,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('ceiling')
  })

  it('accepts a sale exactly at the ceiling', () => {
    expect(
      classifyTipoFactura({
        totalAmount: SIMPLIFIED_INVOICE_CEILING,
        hasRecipient: false,
        creditsInvoice: false,
      }),
    ).toEqual({ ok: true, tipoFactura: 'F2' })
  })

  it('never binds on real data — the largest invoice ever issued is 216', () => {
    expect(SIMPLIFIED_INVOICE_CEILING).toBeGreaterThan(216)
  })
})

describe('buildDesglose', () => {
  it('groups lines by rate and sums base and VAT', () => {
    const r = buildDesglose([
      { vatRate: 21, charge: 100, tax: 21 },
      { vatRate: 21, charge: 50, tax: 10.5 },
      { vatRate: 10, charge: 20, tax: 2 },
    ])
    expect(r).toEqual({
      ok: true,
      entries: [
        { tipoImpositivo: 10, baseImponible: 20, cuotaRepercutida: 2 },
        { tipoImpositivo: 21, baseImponible: 150, cuotaRepercutida: 31.5 },
      ],
    })
  })

  it('rounds to cents so summed floats do not reach the wire', () => {
    const r = buildDesglose([
      { vatRate: 21, charge: 0.1, tax: 0.1 },
      { vatRate: 21, charge: 0.2, tax: 0.2 },
    ])
    if (!r.ok) throw new Error('expected ok')
    expect(r.entries[0]!.baseImponible).toBe(0.3)
  })

  it('REFUSES a null rate rather than declaring a 0% supply', () => {
    // fiscal.ts buckets null under 0 for a monthly summary, which is fine
    // there and unacceptable here. Four production lines carry a null rate.
    const r = buildDesglose([{ vatRate: null, charge: 10, tax: 0 }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('no VAT rate')
  })

  it.each([20.98, 21.01, 21.03, 20])('REFUSES the drifted rate %s%%', (rate) => {
    // These are real stored values, produced by issueCashCreditNote
    // recomputing totalTax/totalCharge*100 instead of carrying the original.
    // AEAT rejects them outright.
    const r = buildDesglose([{ vatRate: rate, charge: 100, tax: rate }])
    expect(r.ok).toBe(false)
  })

  it.each([0, 4, 10, 21])('accepts the legal rate %s%%', (rate) => {
    expect(buildDesglose([{ vatRate: rate, charge: 100, tax: 1 }]).ok).toBe(true)
  })

  it('refuses an invoice with no lines', () => {
    expect(buildDesglose([]).ok).toBe(false)
  })

  it('exposes the legal set for callers that want to validate earlier', () => {
    expect(isLegalEsVatRate(21)).toBe(true)
    expect(isLegalEsVatRate(20.98)).toBe(false)
  })
})
