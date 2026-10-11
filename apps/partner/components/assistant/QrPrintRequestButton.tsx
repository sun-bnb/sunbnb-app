'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSite } from '@/app/sites/site-context'
import { getItemsByGroups } from '@/app/sites/[id]/queries'
import type { InventoryItem } from '@/types/shared'
import { qrButtonTarget, selectQrItems } from './qr-request'
import type { QrPrintRequest } from './stream-reducer'

/**
 * The assistant asked for QR cards (`qr_print`). The PDF download is started from a click here,
 * not on arrival of the event: a download kicked off by a stream callback has no user gesture
 * and browsers (esp. iOS Safari) silently drop it.
 */
export default function QrPrintRequestButton({ request }: { request: QrPrintRequest }) {
  const t = useTranslations('Assistant.qr')
  const { site } = useSite()
  const [busy, setBusy] = useState(false)
  const [empty, setEmpty] = useState(false)
  const target = qrButtonTarget(request)

  const print = async () => {
    setBusy(true)
    setEmpty(false)
    try {
      let pool: InventoryItem[] = site.inventoryItems || []
      // Parcel tier: the parcel's seats may not be loaded yet.
      if (request.parcel !== undefined && site.id) {
        const rows = await getItemsByGroups(site.id, [request.parcel])
        if (rows) pool = rows as InventoryItem[]
      }
      const items = selectQrItems(pool, request)
      if (items.length === 0) {
        setEmpty(true)
        return
      }
      const { printQrCards } = await import('@/app/sites/[id]/inventory/qr-pdf')
      await printQrCards({ siteId: site.id || '', siteCode: site.code, items })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full space-y-1">
      <button type="button" onClick={print} disabled={busy} className="btn-ghost min-h-[40px] border border-gray-200 bg-white text-xs lg:min-h-0">
        {busy
          ? t('preparing')
          : target.kind === 'parcel'
            ? t('printParcel', { parcel: target.parcel })
            : t('printSeats', { count: target.count })}
      </button>
      {empty && <p role="status" className="text-xs text-amber-700">{t('none')}</p>}
    </div>
  )
}
