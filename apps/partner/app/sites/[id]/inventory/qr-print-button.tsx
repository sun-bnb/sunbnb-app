'use client'

import React from 'react'
import Button from '@mui/material/Button'
import { InventoryItem } from '@/types/shared'
import { printQrCards } from './qr-pdf'

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
  const handlePrint = () => printQrCards({ siteId, siteCode, items })

  return (
    <Button variant="outlined" onClick={handlePrint}>
      {label}
    </Button>
  )
}
