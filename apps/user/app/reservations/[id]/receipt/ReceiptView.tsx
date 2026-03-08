'use client'

import React, { ComponentType } from 'react'
import { PDFDownloadLink } from '@react-pdf/renderer'
import { ReceiptProps, InvoiceSection, formatCurrency } from './ReceiptPage'
import PdfReceipt from './PdfReceipt'

function SectionBlock({ section, label }: { section: InvoiceSection; label?: string }) {
  return (
    <div className="mb-2">
      {/* Merchant header */}
      <div className="bg-gray-50 border-b border-gray-200 px-5 py-4 text-center">
        {label && (
          <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">{label}</div>
        )}
        <div className="text-sm font-bold text-gray-900">{section.merchantName}</div>
        {section.merchantVatId && (
          <div className="text-xs text-gray-500 mt-0.5">{section.merchantVatId}</div>
        )}
        {section.merchantAddress && (
          <div className="text-xs text-gray-500 mt-0.5">{section.merchantAddress}</div>
        )}
        {section.merchantPhone && (
          <div className="text-xs text-gray-500 mt-0.5">{section.merchantPhone}</div>
        )}
        {section.invoiceNumber && (
          <div className="text-[10px] text-gray-400 mt-1">Invoice {section.invoiceNumber}</div>
        )}
      </div>

      {/* Line items */}
      <div className="px-5 py-3">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 font-semibold text-gray-600">Item</th>
              <th className="text-right py-2 font-semibold text-gray-600 w-16">Charge</th>
              <th className="text-right py-2 font-semibold text-gray-600 w-14">VAT</th>
              <th className="text-right py-2 font-semibold text-gray-600 w-16">Price</th>
            </tr>
          </thead>
          <tbody>
            {section.lines.map((line, index) => {
              let description = line.description || ''
              if (description.length > 40) {
                description = description.substring(0, 40) + '...'
              }
              return (
                <tr key={index} className={index % 2 === 0 ? 'bg-gray-50/50' : ''}>
                  <td className="py-1.5 text-gray-700">{description}</td>
                  <td className="text-right py-1.5 text-gray-600 tabular-nums">
                    {formatCurrency(line.charge)}
                  </td>
                  <td className="text-right py-1.5 text-gray-600 tabular-nums">
                    {formatCurrency(line.vat)}
                  </td>
                  <td className="text-right py-1.5 text-gray-800 font-medium tabular-nums">
                    {formatCurrency(line.total)} &euro;
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Section subtotals */}
      <div className="mx-5 border-t border-gray-300 pt-2 pb-3">
        <div className="flex justify-between text-xs text-gray-600 mb-1">
          <span>Subtotal</span>
          <span className="tabular-nums">{formatCurrency(section.subtotalCharge)} &euro;</span>
        </div>
        <div className="flex justify-between text-xs text-gray-600 mb-1">
          <span>VAT</span>
          <span className="tabular-nums">{formatCurrency(section.subtotalVat)} &euro;</span>
        </div>
        <div className="flex justify-between text-xs font-semibold text-gray-800 border-t border-gray-200 pt-1">
          <span>Total</span>
          <span className="tabular-nums">{formatCurrency(section.subtotalAmount)} &euro;</span>
        </div>
      </div>
    </div>
  )
}

function ReceiptDoc({ receipt }: { receipt: ReceiptProps }) {
  return (
    <div className="max-w-md mx-auto bg-white text-gray-800">
      {/* Reservation info */}
      {(receipt.siteName || receipt.reservationDate || receipt.seatNumbers) && (
        <div className="px-5 py-3 border-b border-dashed border-gray-200">
          {receipt.siteName && (
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Location</span>
              <span className="font-medium text-gray-800">{receipt.siteName}</span>
            </div>
          )}
          {receipt.reservationDate && (
            <div className="flex justify-between text-xs mt-1">
              <span className="text-gray-500">Date</span>
              <span className="font-medium text-gray-800">{receipt.reservationDate}</span>
            </div>
          )}
          {receipt.seatNumbers && (
            <div className="flex justify-between text-xs mt-1">
              <span className="text-gray-500">Seats</span>
              <span className="font-medium text-gray-800">{receipt.seatNumbers}</span>
            </div>
          )}
        </div>
      )}

      {/* Partner section — products/services */}
      <SectionBlock section={receipt.partnerSection} label="Service Provider" />

      {/* Platform section — service fee */}
      {receipt.platformSection && (
        <SectionBlock section={receipt.platformSection} label="Platform Fee" />
      )}

      {/* Grand total */}
      <div className="mx-5 border-t-2 border-gray-400 pt-3 pb-4">
        <div className="flex justify-between text-sm font-bold text-gray-900">
          <span>Total Paid</span>
          <span className="tabular-nums">{formatCurrency(receipt.grandTotal)} &euro;</span>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 pb-5 text-center text-[10px] text-gray-400">
        {receipt.date}
      </div>
    </div>
  )
}

export default function ReceiptView({ receipt }: { receipt: ReceiptProps }) {
  const SafePDFDownloadLink = PDFDownloadLink as unknown as ComponentType<any>

  return (
    <div>
      <div>
        <ReceiptDoc receipt={receipt} />
      </div>
      <div className="w-full text-center flex justify-center mt-6 mb-8">
        <div className="cursor-pointer bg-gray-700 hover:bg-gray-600 transition-colors text-white text-sm px-5 py-2 rounded-lg">
          <SafePDFDownloadLink
            document={<PdfReceipt receipt={receipt} />}
            fileName={`receipt-${new Date().toISOString()}.pdf`}
          >
            {({ blob, url, loading, error }: { blob?: Blob; url?: string; loading: boolean; error?: Error }) =>
              loading ? 'Preparing PDF...' : 'Download receipt'
            }
          </SafePDFDownloadLink>
        </div>
      </div>
    </div>
  )
}
