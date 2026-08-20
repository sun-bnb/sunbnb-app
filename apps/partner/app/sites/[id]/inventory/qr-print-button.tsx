'use client'

import React from 'react'
import { jsPDF } from 'jspdf'
import QRCode from 'qrcode'
import { formatSeatId } from '@repo/data/seat-label'
import { qrCardUrl } from './qr-url'
import Button from '@mui/material/Button'
import { InventoryItem } from '@/types/shared'

interface Props {
  siteId: string
  /**
   * `Site.code` — the short QR URL's site half (track 022). Optional because an
   * environment may not have been backfilled yet; `qrCardUrl` then prints the
   * legacy URL, which still resolves.
   */
  siteCode?: string | null
  label: string
  items: InventoryItem[]
}

export default function QRPrintButton({ siteId, siteCode, label, items }: Props) {
  const handlePrint = async () => {
    if (!items || items.length === 0) return

    // 1) Generate QR code data-URLs for every item
    const qrDataUrls = await Promise.all(
      items.map(async (item) => {
        const url = qrCardUrl({
          appUrl: process.env.NEXT_PUBLIC_APP_URL as string,
          siteId,
          siteCode,
          item,
        })
        return QRCode.toDataURL(url, { margin: 1, width: 300 })
      })
    )

    // 2) Create A4 PDF (mm units)
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

    // 3) Layout constants
    const pageWidth = 210      // A4 width
    const pageHeight = 297     // A4 height
    const margin = 10          // 10 mm margin
    const frameW = 60          // frame width
    const frameH = 80          // frame height
    const cols = 3
    const rows = 3
    const itemsPerPage = cols * rows

    // Compute gaps so frames + gaps fill the printable area
    const hGap = (pageWidth - margin * 2 - frameW * cols) / (cols - 1)
    const vGap = (pageHeight - margin * 2 - frameH * rows) / (rows - 1)

    // 4) Loop through all items, placing them page by page
    for (let idx = 0; idx < items.length; idx++) {
      const pageIndex = Math.floor(idx / itemsPerPage)
      const idxInPage = idx % itemsPerPage
      const row = Math.floor(idxInPage / cols)
      const col = idxInPage % cols

      // If not the first page, add a new one
      if (pageIndex > 0 && idxInPage === 0) {
        doc.addPage()
      }

      // Calculate origin of this frame
      const originX = margin + col * (frameW + hGap)
      const originY = margin + row * (frameH + vGap)

      const item = items[idx]
      const qrDataUrl = qrDataUrls[idx] // matching QR for this item

      // Draw frame border
      doc.setLineWidth(0.5)
      doc.rect(originX, originY, frameW, frameH)

      // Draw "SCAN & PAY" at top center of frame
      doc.setFontSize(20)
      doc.setFont('helvetica', 'bold')
      const scanText = 'SCAN & PAY'
      const scanW = doc.getTextWidth(scanText)
      const scanX = originX + (frameW - scanW) / 2
      const scanY = originY + 10
      doc.text(scanText, scanX, scanY)

      // Place QR code (50 mm square), centered below "SCAN & PAY"
      const qrSize = 50
      const qrX = originX + (frameW - qrSize) / 2
      const qrY = scanY + 4
      doc.addImage(qrDataUrl!, 'PNG', qrX, qrY, qrSize, qrSize)

      // Draw seat label beneath the QR code
      doc.setFontSize(20)
      doc.setFont('helvetica', 'normal')
      const seatText = `SEAT ${formatSeatId(item!, { parcel: true })}`
      const seatW = doc.getTextWidth(seatText)
      const seatX = originX + (frameW - seatW) / 2
      const seatY = qrY + qrSize + 10
      doc.text(seatText, seatX, seatY)
    }

    // 5) Trigger download
    doc.save(`qr-codes.pdf`)
  }

  return (
    <Button variant="outlined" onClick={handlePrint}>
      {label}
    </Button>
  )
}
