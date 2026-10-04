'use client'

import Link from 'next/link'
import {
  REVERSE_CHARGE_NOTE,
  type CommissionInvoiceModel,
} from '@repo/data/commission-invoice-model'

/**
 * The commission invoice as a readable, printable document.
 *
 * Mirrors the consumer receipt's fiscal block deliberately — same label above,
 * same legend below, same 23px white quiet zone supplied here rather than baked
 * into the PNG (art. 21.1 measures the CODE at 30–40 mm, so a margin inside the
 * image eats into the mandated size). Divergence between the two renderings of
 * the same mandated furniture is exactly what phase 4 existed to stop.
 */
export default function CommissionInvoiceDocument({
  invoice,
}: {
  invoice: CommissionInvoiceModel
}) {
  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-6 print:hidden">
        <Link href="/account/invoices" className="text-xs text-gray-500 hover:underline">
          ← All commission invoices
        </Link>
        <button type="button" onClick={() => window.print()} className="btn-ghost text-xs">
          Print / save as PDF
        </button>
      </div>

      <div className="card print:border-0 print:shadow-none">
        {/* Header */}
        <div className="flex justify-between items-start border-b border-gray-200 pb-4 mb-4">
          <div>
            <h1 className="text-base font-bold text-gray-900">Factura</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {invoice.invoiceNumber ?? '(no number)'}
            </p>
          </div>
          <div className="text-right text-xs text-gray-500">
            <div>{invoice.issuedOn}</div>
          </div>
        </div>

        {/* The two parties. Both are named: this is a factura completa (F1),
            not a simplified receipt. */}
        <div className="grid grid-cols-2 gap-6 mb-6 text-xs">
          <Party title="Issued by" party={invoice.issuer} />
          <Party title="Billed to" party={invoice.recipient} />
        </div>

        {/* Lines */}
        <table className="w-full text-xs mb-4">
          <thead>
            <tr className="text-gray-500 border-b border-gray-200">
              <th className="text-left py-2 font-medium">Description</th>
              <th className="text-right py-2 font-medium">Base</th>
              <th className="text-right py-2 font-medium">VAT</th>
              <th className="text-right py-2 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, i) => (
              <tr key={i} className="border-b border-gray-100">
                <td className="py-2 text-gray-800">{line.description ?? '—'}</td>
                <td className="py-2 text-right text-gray-600">{line.charge.toFixed(2)}</td>
                <td className="py-2 text-right text-gray-600">
                  {line.vatRate === null ? '—' : `${line.vatRate}%`}
                  {line.vat > 0 && (
                    <span className="text-gray-400"> · {line.vat.toFixed(2)}</span>
                  )}
                </td>
                <td className="py-2 text-right text-gray-800">{line.total.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="flex flex-col items-end gap-1 text-xs border-t border-gray-200 pt-3">
          <Total label="Base imponible" value={invoice.subtotalCharge} />
          <Total label="IVA" value={invoice.subtotalVat} />
          <div className="flex gap-6 font-semibold text-gray-900 text-sm mt-1">
            <span>Total</span>
            <span>{invoice.totalAmount.toFixed(2)} €</span>
          </div>
        </div>

        {/* Reverse charge. Art. 6.1.m RD 1619/2012 requires the invoice to state
            WHY no VAT was charged — a 0 figure with no explanation is not a
            valid invoice, which is why this is not conditional styling on a
            badge somewhere. */}
        {invoice.reverseCharge && (
          <p className="mt-5 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
            {REVERSE_CHARGE_NOTE}
          </p>
        )}

        {/* The AEAT fiscal block. Absent when our issuing entity is not a
            Veri*factu filer — render nothing, not a gap. */}
        {invoice.fiscal && (
          <div className="flex flex-col items-center mt-8 pt-6 border-t border-gray-200">
            <div className="text-xs text-gray-900 mb-1">{invoice.fiscal.labelAbove}</div>
            <a
              href={invoice.fiscal.qrUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white"
              style={{ padding: '23px' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={invoice.fiscal.qrImageUrl}
                alt={invoice.fiscal.labelAbove}
                width={132}
                height={132}
                style={{ width: '132px', height: '132px', imageRendering: 'pixelated' }}
              />
            </a>
            <div className="text-xs font-semibold text-gray-900 mt-1">
              {invoice.fiscal.legendBelow}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Party({
  title,
  party,
}: {
  title: string
  party: CommissionInvoiceModel['issuer']
}) {
  return (
    <div>
      <div className="text-gray-400 uppercase tracking-wide text-[10px] mb-1">{title}</div>
      <div className="font-medium text-gray-900">{party.name || '—'}</div>
      {party.vatId && <div className="text-gray-600">{party.vatId}</div>}
      {party.address && <div className="text-gray-500 whitespace-pre-line">{party.address}</div>}
    </div>
  )
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex gap-6 text-gray-600">
      <span>{label}</span>
      <span className="text-gray-800">{value.toFixed(2)}</span>
    </div>
  )
}
