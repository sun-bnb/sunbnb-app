'use client'

import React, { useState } from 'react'
import { jsPDF } from 'jspdf'
import QRCode from 'qrcode'

export interface TableQREntry {
  id: string
  number: number
  label: string | null
}

interface Props {
  /** The Site.id that owns the restaurant — used to build /sites/<siteId>/dine/<tableId>. */
  siteId: string
  /** Base URL of the consumer-facing app (e.g. https://sunbnb.app or CONSUMER_APP_URL). */
  consumerAppUrl: string
  /** Active tables to print. Caller is responsible for filtering by status. */
  tables: TableQREntry[]
  label: string
}

/**
 * Generates a PDF of per-table QR codes for the dine-in tab flow.
 * Each card links to /sites/<siteId>/dine/<tableId> on the consumer app.
 *
 * Lives in apps/partner ONLY — the URL is Sunbnb-specific wiring; do not
 * move to @repo/table-reservations-ui.
 */
export default function DineInQRButton({ siteId, consumerAppUrl, tables, label }: Props) {
  const [busy, setBusy] = useState(false)

  const handlePrint = async () => {
    if (!tables || tables.length === 0) return
    setBusy(true)
    try {
      // Generate QR data-URLs for every table
      const qrDataUrls = await Promise.all(
        tables.map((table) => {
          const url = `${consumerAppUrl}/sites/${siteId}/dine/${table.id}`
          return QRCode.toDataURL(url, { margin: 1, width: 300 })
        }),
      )

      // A4 PDF, 3 × 3 grid of cards
      const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

      const pageWidth = 210
      const pageHeight = 297
      const margin = 10
      const frameW = 60
      const frameH = 80
      const cols = 3
      const rows = 3
      const itemsPerPage = cols * rows

      const hGap = (pageWidth - margin * 2 - frameW * cols) / (cols - 1)
      const vGap = (pageHeight - margin * 2 - frameH * rows) / (rows - 1)

      for (let idx = 0; idx < tables.length; idx++) {
        const pageIndex = Math.floor(idx / itemsPerPage)
        const idxInPage = idx % itemsPerPage
        const row = Math.floor(idxInPage / cols)
        const col = idxInPage % cols

        if (pageIndex > 0 && idxInPage === 0) {
          doc.addPage()
        }

        const originX = margin + col * (frameW + hGap)
        const originY = margin + row * (frameH + vGap)

        const table = tables[idx]!
        const qrDataUrl = qrDataUrls[idx]!

        // Border
        doc.setLineWidth(0.5)
        doc.rect(originX, originY, frameW, frameH)

        // "SCAN TO ORDER" heading
        doc.setFontSize(14)
        doc.setFont('helvetica', 'bold')
        const heading = 'SCAN TO ORDER'
        const headingW = doc.getTextWidth(heading)
        doc.text(heading, originX + (frameW - headingW) / 2, originY + 10)

        // QR code (50 mm square), centred below heading
        const qrSize = 50
        const qrX = originX + (frameW - qrSize) / 2
        const qrY = originY + 14
        doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize)

        // Table number + optional label below the QR
        const tableText = table.label
          ? `Table ${table.number} — ${table.label}`
          : `Table ${table.number}`
        doc.setFontSize(12)
        doc.setFont('helvetica', 'normal')
        const tableW = doc.getTextWidth(tableText)
        doc.text(tableText, originX + (frameW - tableW) / 2, qrY + qrSize + 8)
      }

      doc.save('table-qr-codes.pdf')
    } finally {
      setBusy(false)
    }
  }

  if (!tables || tables.length === 0) return null

  return (
    <button
      type="button"
      onClick={handlePrint}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="w-4 h-4"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a1 1 0 001 1h8a1 1 0 001-1v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a1 1 0 00-1-1H6a1 1 0 00-1 1zm2 0h6v3H7V4zm-1 9v-1h8v1H6zm8 2H6v-1h8v1z"
          clipRule="evenodd"
        />
      </svg>
      {busy ? 'Generating…' : label}
    </button>
  )
}
