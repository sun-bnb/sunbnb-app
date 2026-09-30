import { describe, it, expect } from 'vitest'
import {
  buildDesglose,
  classifyTipoFactura,
  isLegalEsVatRate,
  SIMPLIFIED_CEILING_GENERAL,
  SIMPLIFIED_CEILING_LISTED,
  simplifiedCeilingFor,
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

  it('REFUSES a recipient-less sale above the ceiling that applies to it', () => {
    // It can be neither F2 (over the limit) nor F1 (no recipient details were
    // ever collected). Surfacing that is the only honest option.
    const r = classifyTipoFactura({
      totalAmount: SIMPLIFIED_CEILING_GENERAL + 0.01,
      hasRecipient: false,
      creditsInvoice: false,
      productCodes: ['sunbed-rental'],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('RD 1619/2012')
  })

  it('accepts a sale exactly at the ceiling', () => {
    expect(
      classifyTipoFactura({
        totalAmount: SIMPLIFIED_CEILING_GENERAL,
        hasRecipient: false,
        creditsInvoice: false,
        productCodes: ['sunbed-rental'],
      }),
    ).toEqual({ ok: true, tipoFactura: 'F2' })
  })

  it('lets a hostelería sale run to the higher ceiling', () => {
    // RD 1619/2012 art. 4.2.e — the clearest entry on the list for a chiringuito.
    expect(
      classifyTipoFactura({
        totalAmount: 1500,
        hasRecipient: false,
        creditsInvoice: false,
        productCodes: ['food-and-beverage'],
      }),
    ).toEqual({ ok: true, tipoFactura: 'F2' })
  })

  it('never binds on real data — the largest invoice ever issued is 216', () => {
    expect(SIMPLIFIED_CEILING_GENERAL).toBeGreaterThan(216)
  })
})

describe('simplifiedCeilingFor', () => {
  it('puts hostelería on the higher ceiling and loungers on the general one', () => {
    expect(simplifiedCeilingFor(['food-and-beverage'])).toBe(SIMPLIFIED_CEILING_LISTED)
    expect(simplifiedCeilingFor(['sunbed-rental'])).toBe(SIMPLIFIED_CEILING_GENERAL)
  })

  it('takes the LOWEST ceiling on a mixed receipt', () => {
    // A receipt with loungers and drinks is not covered by the higher limit
    // merely because half of it would be. The alternative is deciding a mixed
    // sale is whichever half is convenient.
    expect(simplifiedCeilingFor(['food-and-beverage', 'sunbed-rental']))
      .toBe(SIMPLIFIED_CEILING_GENERAL)
  })

  it('treats an unclassified or missing code as general', () => {
    // A code nobody has classified is not evidence of belonging to the list.
    expect(simplifiedCeilingFor(['something-new'])).toBe(SIMPLIFIED_CEILING_GENERAL)
    expect(simplifiedCeilingFor([null])).toBe(SIMPLIFIED_CEILING_GENERAL)
    expect(simplifiedCeilingFor([])).toBe(SIMPLIFIED_CEILING_GENERAL)
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
        // `calificacionOperacion` is mandatory inside DetalleDesglose per AEAT's
        // XSD — S1 is an ordinary taxed domestic supply, which is all we emit.
        { calificacionOperacion: 'S1', tipoImpositivo: 10, baseImponible: 20, cuotaRepercutida: 2 },
        { calificacionOperacion: 'S1', tipoImpositivo: 21, baseImponible: 150, cuotaRepercutida: 31.5 },
      ],
    })
  })

  it('REFUSES a reverse-charge invoice rather than calling it a 0% supply', () => {
    // A cross-border EU B2B commission invoice carries 0 VAT because the customer
    // self-accounts — that is NOT the same statement as "taxed at 0%", and S1 at
    // 0.00 would misstate it to AEAT. The right code (N2, or an OperacionExenta)
    // is an open question for the asesor (D6), so this refuses instead of guessing.
    const r = buildDesglose([{ vatRate: 0, charge: 100, tax: 0 }], { reverseCharge: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/reverse-charge/i)
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
