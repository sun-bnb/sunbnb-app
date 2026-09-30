import { describe, it, expect } from 'vitest'
import {
  buildInvoiceQrUrl,
  AEAT_QR_URL_PRODUCTION,
  AEAT_QR_URL_PRUEBAS,
  NUMSERIE_MAX_LENGTH,
  QR_IMAGE_SPEC,
  QR_LABEL_ABOVE,
  QR_LEGEND_BELOW,
} from './qr'
import { formatFechaExpedicion } from './huella'

describe('buildInvoiceQrUrl', () => {
  const ok = (r: ReturnType<typeof buildInvoiceQrUrl>) => {
    if (!r.ok) throw new Error(`expected ok, got: ${r.reason}`)
    return r.url
  }

  // ── AEAT's own worked examples, verbatim from the spec (v0.5.0, 10/12/2025) ──

  it("reproduces §4's URL-encoding example", () => {
    // §4 exists because of this case: an invoice number containing `&`. Left
    // unencoded the URL still parses, as a DIFFERENT request with a truncated
    // numserie and a stray parameter — the spec prints that as its wrong answer.
    //
    // One deliberate deviation: the spec writes this example's amount as
    // `241.4`, we write `241.40`. §6 caps the decimal part at two digits rather
    // than fixing it, so both are valid; two is chosen so the QR and the huella
    // (`formatImporte`) can never render the same charge differently.
    const url = ok(
      buildInvoiceQrUrl({
        issuerNif: '89890001K',
        invoiceNumber: '12345678&G33',
        fechaExpedicion: '01-01-2024',
        totalAmount: 241.4,
        environment: 'pruebas',
      }),
    )
    expect(url).toBe(
      'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR' +
        '?nif=89890001K&numserie=12345678%26G33&fecha=01-01-2024&importe=241.40',
    )
    // The spec's own negative example: the raw `&` must not survive.
    expect(url).not.toContain('numserie=12345678&G33')
  })

  it("reproduces §8.1's pruebas example (amount to two decimals, as above)", () => {
    expect(
      ok(
        buildInvoiceQrUrl({
          issuerNif: '89890001K',
          invoiceNumber: '12345678-G33',
          fechaExpedicion: '01-09-2024',
          totalAmount: 241.4,
          environment: 'pruebas',
        }),
      ),
    ).toBe(
      'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR' +
        '?nif=89890001K&numserie=12345678-G33&fecha=01-09-2024&importe=241.40',
    )
  })

  it('defaults to the production cotejo service', () => {
    const url = ok(
      buildInvoiceQrUrl({
        issuerNif: 'B22435705',
        invoiceNumber: 'AB-F-2026-00001',
        fechaExpedicion: '14-08-2026',
        totalAmount: 26.65,
      }),
    )
    expect(url.startsWith(`${AEAT_QR_URL_PRODUCTION}?`)).toBe(true)
    expect(url).toContain('nif=B22435705')
    expect(url).toContain('numserie=AB-F-2026-00001')
    expect(url).toContain('importe=26.65')
  })

  it('never uses the non-verifiable endpoint', () => {
    // ValidarQRNoVerifactu is for a system that does NOT issue verifiable
    // invoices. That is a property of the software, not of one invoice, so it
    // must never appear here — not even as a fallback for a queued record.
    for (const env of ['production', 'pruebas'] as const) {
      const url = ok(
        buildInvoiceQrUrl({
          issuerNif: 'B22435705',
          invoiceNumber: 'AB-F-2026-00002',
          fechaExpedicion: '01-09-2026',
          totalAmount: 10,
          environment: env,
        }),
      )
      expect(url).not.toContain('NoVerifactu')
    }
    expect(AEAT_QR_URL_PRODUCTION).not.toContain('NoVerifactu')
    expect(AEAT_QR_URL_PRUEBAS).not.toContain('NoVerifactu')
  })

  it('never carries the formato parameter', () => {
    // §7.2 is explicit: `formato=json` may never be in a QR's URL. A guest
    // scanning a receipt must reach the human page, not a JSON body.
    const url = ok(
      buildInvoiceQrUrl({
        issuerNif: 'B22435705',
        invoiceNumber: 'AB-F-2026-00003',
        fechaExpedicion: '01-09-2026',
        totalAmount: 10,
      }),
    )
    expect(url).not.toContain('formato')
    expect(url.split('?')[1]!.split('&').map((p) => p.split('=')[0])).toEqual([
      'nif',
      'numserie',
      'fecha',
      'importe',
    ])
  })

  // ── amounts ──

  it('writes the amount with a dot and two decimals', () => {
    // §9.4's error example is `importe=7,2` → "El importe tiene un formato
    // incorrecto". A locale-formatted number is the obvious way to produce that.
    const url = ok(
      buildInvoiceQrUrl({
        issuerNif: 'B22435705',
        invoiceNumber: 'AB-F-2026-00004',
        fechaExpedicion: '01-09-2026',
        totalAmount: 1234.5,
      }),
    )
    expect(url).toContain('importe=1234.50')
    expect(url).not.toContain(',')
  })

  it('keeps the sign of a credit note', () => {
    const url = ok(
      buildInvoiceQrUrl({
        issuerNif: 'B22435705',
        invoiceNumber: 'AB-R-2026-00001',
        fechaExpedicion: '01-09-2026',
        totalAmount: -26.65,
      }),
    )
    expect(url).toContain('importe=-26.65')
  })

  it('refuses an amount with more than 12 integer digits', () => {
    const r = buildInvoiceQrUrl({
      issuerNif: 'B22435705',
      invoiceNumber: 'AB-F-2026-00005',
      fechaExpedicion: '01-09-2026',
      totalAmount: 12345678901234,
    })
    expect(r.ok).toBe(false)
  })

  it('refuses a non-finite amount', () => {
    expect(
      buildInvoiceQrUrl({
        issuerNif: 'B22435705',
        invoiceNumber: 'AB-F-2026-00006',
        fechaExpedicion: '01-09-2026',
        totalAmount: Number.NaN,
      }).ok,
    ).toBe(false)
  })

  // ── the refusals ──

  it('refuses a missing issuer NIF rather than drawing an anonymous QR', () => {
    // This is the failure mode production already produced once: an invoice
    // issued with a NULL tax id. A QR without one identifies nobody.
    const r = buildInvoiceQrUrl({
      issuerNif: '   ',
      invoiceNumber: 'AB-F-2026-00007',
      fechaExpedicion: '01-09-2026',
      totalAmount: 10,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/NIF/i)
  })

  it('refuses a missing invoice number', () => {
    expect(
      buildInvoiceQrUrl({
        issuerNif: 'B22435705',
        invoiceNumber: '',
        fechaExpedicion: '01-09-2026',
        totalAmount: 10,
      }).ok,
    ).toBe(false)
  })

  it(`refuses an invoice number over ${NUMSERIE_MAX_LENGTH} characters`, () => {
    const r = buildInvoiceQrUrl({
      issuerNif: 'B22435705',
      invoiceNumber: 'A'.repeat(NUMSERIE_MAX_LENGTH + 1),
      fechaExpedicion: '01-09-2026',
      totalAmount: 10,
    })
    expect(r.ok).toBe(false)
    // Exactly at the cap is fine.
    expect(
      buildInvoiceQrUrl({
        issuerNif: 'B22435705',
        invoiceNumber: 'A'.repeat(NUMSERIE_MAX_LENGTH),
        fechaExpedicion: '01-09-2026',
        totalAmount: 10,
      }).ok,
    ).toBe(true)
  })

  it('refuses a non-ASCII invoice number', () => {
    // §4: text may only contain printable ASCII 32–126. A partner prefix taken
    // from a company name is exactly where an "Ñ" or an accent would arrive.
    const r = buildInvoiceQrUrl({
      issuerNif: 'B22435705',
      invoiceNumber: 'PEÑA-F-2026-00001',
      fechaExpedicion: '01-09-2026',
      totalAmount: 10,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/ASCII/)
  })

  it('refuses a date that is not DD-MM-YYYY', () => {
    for (const bad of ['2026-09-01', '1-9-2026', '01/09/2026', '']) {
      expect(
        buildInvoiceQrUrl({
          issuerNif: 'B22435705',
          invoiceNumber: 'AB-F-2026-00008',
          fechaExpedicion: bad,
          totalAmount: 10,
        }).ok,
      ).toBe(false)
    }
  })

  it('accepts what formatFechaExpedicion produces', () => {
    // The two must agree, or every QR is refused in production while every unit
    // test that hand-writes a date passes.
    const fecha = formatFechaExpedicion(new Date('2026-08-14T21:30:00Z'), 'Europe/Madrid')
    expect(fecha).toBe('14-08-2026')
    expect(
      buildInvoiceQrUrl({
        issuerNif: 'B22435705',
        invoiceNumber: 'AB-F-2026-00009',
        fechaExpedicion: fecha,
        totalAmount: 10,
      }).ok,
    ).toBe(true)
  })
})

describe('the printed presentation', () => {
  it('fixes the two literals the order mandates', () => {
    // §3: «QR tributario:» always above; the verifiable phrase below. These are
    // legal literals — if a locale file can change them, the law is negotiable.
    expect(QR_LABEL_ABOVE).toBe('QR tributario:')
    expect(QR_LEGEND_BELOW).toBe('VERI*FACTU')
  })

  it('mandates error correction level M', () => {
    // art. 21.1 names level M. `qrcode` defaults to M, so this is a guard
    // against someone "optimising" the image to L for density.
    expect(QR_IMAGE_SPEC.errorCorrectionLevel).toBe('M')
    expect(QR_IMAGE_SPEC.minSizeMm).toBe(30)
    expect(QR_IMAGE_SPEC.maxSizeMm).toBe(40)
  })
})
