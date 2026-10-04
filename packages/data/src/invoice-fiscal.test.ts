import { describe, it, expect } from 'vitest'
import { buildInvoiceFiscal, type FiscalInvoiceFields } from './invoice-fiscal'
import { PLATFORM_ES_ISSUER_NIF } from './tax/es-verifactu/sistema-informatico'

const BASE = {
  id: 'cmtestinvoice000000000001',
  invoiceNumber: 'AB-F-2026-00001',
  invoicedAt: new Date('2026-07-10T09:30:00Z'),
  totalAmount: 121,
}

function fields(over: Partial<FiscalInvoiceFields>): FiscalInvoiceFields {
  return {
    ...BASE,
    issuerType: 'PARTNER',
    issuerVatNumber: 'B29806043',
    account: { country: 'ES', taxRegion: 'MA' },
    ...over,
  }
}

describe('buildInvoiceFiscal — whose jurisdiction decides', () => {
  it('uses the ACCOUNT for a partner receipt', () => {
    // The account IS the issuing partner on a PARTNER invoice, so this is the
    // right question to ask there.
    expect(buildInvoiceFiscal(fields({}))).not.toBeNull()
    expect(buildInvoiceFiscal(fields({ account: { country: 'FI', taxRegion: null } }))).toBeNull()
  })

  it('uses OUR tax id for a commission invoice, not the recipient’s', () => {
    // The regression. `Invoice.accountId` on a PLATFORM row is the RECIPIENT, so
    // reading `account.country` asked the customer's jurisdiction about OUR
    // document — and for the Finnish partner it answered "no QR" about an
    // invoice Sunbnb España SL owes one for under art. 20.
    const toFinnishPartner = fields({
      issuerType: 'PLATFORM',
      issuerVatNumber: PLATFORM_ES_ISSUER_NIF,
      invoiceNumber: 'PLATFORM-F-2026-00001',
      account: { country: 'FI', taxRegion: null },
    })
    const fiscal = buildInvoiceFiscal(toFinnishPartner)
    expect(fiscal).not.toBeNull()
    expect(fiscal!.qrUrl).toContain(PLATFORM_ES_ISSUER_NIF)
  })

  it('does not let a FORAL recipient withdraw the QR from our own invoice', () => {
    // The other direction of the same bug: the recipient being TicketBAI
    // territory says nothing about where WE file.
    const fiscal = buildInvoiceFiscal(
      fields({
        issuerType: 'PLATFORM',
        issuerVatNumber: PLATFORM_ES_ISSUER_NIF,
        invoiceNumber: 'PLATFORM-F-2026-00002',
        account: { country: 'ES', taxRegion: 'BI' },
      }),
    )
    expect(fiscal).not.toBeNull()
  })

  it('gives a NON-Spanish group entity of ours no QR', () => {
    // Reachable: the platform has a Finnish entity too, and a commission invoice
    // issued by it is not an AEAT matter. Keyed on the tax id because nothing
    // else on the row identifies which of our entities issued it.
    expect(
      buildInvoiceFiscal(
        fields({
          issuerType: 'PLATFORM',
          issuerVatNumber: 'FI29409571',
          account: { country: 'ES', taxRegion: 'MA' },
        }),
      ),
    ).toBeNull()
  })

  it('carries the mandated label and legend, and a QR image keyed on the invoice id', () => {
    const fiscal = buildInvoiceFiscal(fields({}))!
    expect(fiscal.labelAbove).toBe('QR tributario:')
    expect(fiscal.legendBelow).toBe('VERI*FACTU')
    // Keyed on the id, never on the payload: an endpoint taking nif/importe
    // would draw a QR claiming any amount for any tax id.
    expect(fiscal.qrImageUrl).toContain(`/api/receipts/${BASE.id}/qr.png`)
  })

  it('returns null rather than throwing when the QR cannot be built', () => {
    // The document is the legal obligation and must still be issued; a Spanish
    // invoice arriving without a QR is surfaced by the P9 alert, not by refusing
    // the reader a document.
    expect(buildInvoiceFiscal(fields({ invoiceNumber: null }))).toBeNull()
  })
})
