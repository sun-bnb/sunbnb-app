'use client'

import React, { ComponentType } from 'react'
import { PDFDownloadLink } from '@react-pdf/renderer'
import { ReceiptProps } from './ReceiptPage'
import PdfReceipt from './PdfReceipt'

function ReceiptDoc({ receipt }: { receipt: ReceiptProps }) {

  const content = (
    <div className="w-full p-[6px] text-[12px]">
      <div className="text-center">
        <div className="mb-[36px]">
          <div>{receipt.company}</div>
          <div>{receipt.businessId}</div>
          {receipt.phoneNumber && <div>{receipt.phoneNumber}</div>}
          {receipt.issuerType === 'PLATFORM' && (
            <div className="mt-2">
              <span className="inline-block bg-purple-100 text-purple-700 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                Issued by platform
              </span>
            </div>
          )}
          {receipt.settlementId && (
            <div className="text-[10px] text-gray-400 mt-1">
              Settlement ref: {receipt.settlementId}
            </div>
          )}
        </div>
        <div>
          <table className="w-full text-left">
            <thead>
              <tr>
                <th>Item</th>
                <th>Charge</th>
                <th>VAT</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {
                receipt.invoiceLines.map((line, index) => {

                  let description = line.description || ''
                  
                  if (description && description.length > 50) {
                    description = description.substring(0, 50) + '...';
                  }
                  

                  return (
                    <tr key={index}>
                      <td className="py-[5px]" style={{ maxWidth: '100px' }}>{description}</td>
                      <td>{line.charge}</td>
                      <td>{line.vat}</td>
                      <td>{line.total} €</td>
                    </tr>
                  )
                })
              }
              <tr>
                <td className="p-[8px]"></td>
              </tr>
              <tr>
                <td><b>Total:</b></td>
                <td>{receipt.totalCharge}</td>
                <td>{receipt.totalVat}</td>
                <td>{receipt.totalAmount} €</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-[36px] text-center">
          { receipt.date }
        </div>
      </div>
    </div>
  )

  return content

}

export default function ReceiptView({
  receipt
} : {
  receipt: ReceiptProps
}) {
  const SafePDFDownloadLink = PDFDownloadLink as unknown as ComponentType<any>

  return (
    <div>
      <div>
        <ReceiptDoc receipt={receipt} />
      </div>
      <div className="w-full text-center flex justify-center mt-[36px]">
        <div className="cursor-pointer bg-[#808080] text-white px-2">
          <SafePDFDownloadLink document={<PdfReceipt receipt={receipt} />} fileName={`receipt-${new Date().toISOString()}.pdf`}>
            {
              ({ blob, url, loading, error }: { blob?: Blob, url?: string, loading: boolean, error?: Error }) =>
                loading ? 'Loading document...' : 'Download receipt'
            }
          </SafePDFDownloadLink>
        </div>
      </div>
    </div>
  )

}
