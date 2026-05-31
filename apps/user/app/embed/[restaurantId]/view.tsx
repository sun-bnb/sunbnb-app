'use client'

import { forwardRef, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import TextField from '@mui/material/TextField'
import {
  AvailabilityPicker,
  BookingForm,
  FloorMapPicker,
  type BookingFormValues,
  type FloorMapTable,
  type FloorMapElement,
} from '@repo/table-reservations-ui'
import type { AvailabilitySlot } from '@repo/table-reservations-core'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || ''
const ANON_ID_KEY = 'sunbnb-anonId'

interface Props {
  restaurant: {
    id: string
    name: string
    reservationWindow: number
    siteId: string | null
    guestSelectionEnabled?: boolean
  }
  initialDate?: string
  initialPartySize?: number
}

interface SlotWire {
  from: string
  to: string
  availableTableIds: string[]
  availableCombinationIds?: string[]
}

interface LayoutData {
  world: { width: number; height: number }
  elements: FloorMapElement[]
  tables: FloorMapTable[]
}

interface Confirmed {
  date: string
  time: string
  partySize: number
}

/**
 * The booking widget rendered inside the embed iframe. Chrome-less; talks to the
 * public availability + /book APIs (same-origin within the iframe). Posts its
 * height to the parent so embed.js can auto-resize the iframe.
 */
export default function EmbedBookingView({ restaurant, initialDate, initialPartySize }: Props) {
  const t = useTranslations('TableBooking')

  const today = formatYmd(new Date())
  const maxDate = formatYmd(new Date(Date.now() + restaurant.reservationWindow * 86400000))

  const [date, setDate] = useState(initialDate || today)
  const [partySize, setPartySize] = useState(initialPartySize ?? 2)
  const [slots, setSlots] = useState<SlotWire[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<SlotWire | null>(null)
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [selectedCombinationId, setSelectedCombinationId] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null)
  const [depositRequired, setDepositRequired] = useState(false)
  const [layout, setLayout] = useState<LayoutData | null>(null)

  // "Pick your spot": fetch the floor layout when the venue opts in.
  useEffect(() => {
    if (!restaurant.guestSelectionEnabled) return
    let cancelled = false
    void fetch(`/api/restaurants/${restaurant.id}/layout`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setLayout(data as LayoutData)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [restaurant.id, restaurant.guestSelectionEnabled])

  const selectableIds = new Set(
    (layout?.tables ?? []).filter((tbl) => tbl.guestSelectable).map((tbl) => tbl.id),
  )
  const slotHasSelectable = (slot: SlotWire) =>
    !!restaurant.guestSelectionEnabled &&
    !!layout &&
    slot.availableTableIds.some((id) => selectableIds.has(id))

  const anonIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    let id = window.localStorage.getItem(ANON_ID_KEY)
    if (!id) {
      id = crypto.randomUUID()
      window.localStorage.setItem(ANON_ID_KEY, id)
    }
    anonIdRef.current = id
  }, [])

  // Report height to the parent window so embed.js can size the iframe.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) return
    const post = () => {
      const height = rootRef.current?.offsetHeight ?? document.body.scrollHeight
      window.parent.postMessage({ type: 'sunbnb-embed-resize', height }, '*')
    }
    post()
    const ro = new ResizeObserver(post)
    if (rootRef.current) ro.observe(rootRef.current)
    return () => ro.disconnect()
  })

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoadingSlots(true)
      try {
        const res = await fetch(
          `/api/restaurants/${restaurant.id}/availability?date=${encodeURIComponent(date)}&partySize=${partySize}`,
        )
        if (!res.ok) {
          if (!cancelled) setSlots([])
          return
        }
        const body = (await res.json()) as { slots: SlotWire[] }
        if (!cancelled) {
          setSlots(body.slots)
          setSelectedSlot(null)
          setSelectedTableId(null)
          setSelectedCombinationId(null)
        }
      } finally {
        if (!cancelled) setLoadingSlots(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [restaurant.id, date, partySize])

  const availabilitySlots: AvailabilitySlot[] = slots.map((s) => ({
    from: new Date(s.from),
    to: new Date(s.to),
    availableTableIds: s.availableTableIds,
    ...(s.availableCombinationIds ? { availableCombinationIds: s.availableCombinationIds } : {}),
  }))

  // ── Deposit-required: complete on the hosted page (in-iframe Mollie pay is
  //    deferred — payment redirects inside a third-party iframe are unreliable). ──
  if (depositRequired) {
    const hostedUrl = restaurant.siteId
      ? `${APP_URL}/sites/${restaurant.siteId}/table?date=${encodeURIComponent(date)}&partySize=${partySize}`
      : null
    return (
      <Shell ref={rootRef} title={restaurant.name} poweredBy={t('embedPoweredBy')}>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-800">{t('embedDepositTitle')}</p>
          <p className="mt-1 text-xs text-amber-700">{t('embedDepositBody')}</p>
        </div>
        {hostedUrl ? (
          <a
            href={hostedUrl}
            target="_top"
            className="mt-4 block w-full rounded-lg bg-gray-900 py-3 text-center text-sm font-semibold text-white hover:bg-gray-800"
          >
            {t('embedDepositContinue')}
          </a>
        ) : (
          <p className="mt-4 text-sm text-gray-600">{t('embedDepositContact')}</p>
        )}
      </Shell>
    )
  }

  // ── Success ──────────────────────────────────────────────────────────────────
  if (confirmed) {
    return (
      <Shell ref={rootRef} title={restaurant.name} poweredBy={t('embedPoweredBy')}>
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-4 text-center">
          <p className="text-base font-semibold text-green-800">{t('embedSuccessTitle')}</p>
          <p className="mt-1 text-sm text-green-700">
            {confirmed.date} · {confirmed.time} · {confirmed.partySize} {t('guests')}
          </p>
          <p className="mt-2 text-xs text-green-700">{t('embedSuccessBody')}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setConfirmed(null)
            setSelectedSlot(null)
            setSelectedTableId(null)
            setSelectedCombinationId(null)
          }}
          className="mt-4 w-full rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {t('embedBookAnother')}
        </button>
      </Shell>
    )
  }

  const isComboPick = !!selectedSlot && !selectedTableId && !!selectedCombinationId

  async function submitBooking(values: BookingFormValues) {
    const body = {
      anonId: anonIdRef.current,
      fromIso: selectedSlot!.from,
      toIso: selectedSlot!.to,
      partySize,
      guestName: values.guestName,
      guestEmail: values.guestEmail,
      guestPhone: values.guestPhone || null,
      specialRequests: values.specialRequests || null,
      ...(selectedCombinationId ? { combinationId: selectedCombinationId } : { tableId: selectedTableId }),
    }
    const res = await fetch(`/api/restaurants/${restaurant.id}/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) {
      const errs = Array.isArray(data.error) ? data.error : [data.error ?? 'Booking failed']
      return { status: 'error' as const, errors: errs }
    }
    if (data.requiresDeposit) {
      setDepositRequired(true)
      return { status: 'ok' as const }
    }
    setConfirmed({
      date,
      time: formatTime(selectedSlot!.from),
      partySize,
    })
    return { status: 'ok' as const }
  }

  return (
    <Shell ref={rootRef} title={restaurant.name} poweredBy={t('embedPoweredBy')}>
      <div className="flex gap-3 flex-wrap">
        <TextField
          size="small"
          type="date"
          label={t('dateLabel')}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
          inputProps={{ min: today, max: maxDate }}
          sx={{ minWidth: 170 }}
        />
        <TextField
          size="small"
          type="number"
          label={t('partySizeLabel')}
          value={partySize}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n) && n >= 1 && n <= 50) setPartySize(n)
          }}
          inputProps={{ min: 1, max: 50 }}
          sx={{ width: 130 }}
        />
      </div>

      <section className="mt-5">
        {loadingSlots ? (
          <div className="text-sm text-gray-500 py-4">{t('loadingSlots')}</div>
        ) : (
          <AvailabilityPicker
            slots={availabilitySlots}
            selectedIso={selectedSlot?.from ?? null}
            labels={{
              heading: t('availabilityHeading'),
              empty: t('availabilityEmpty'),
              tablesSuffix: t('tablesSuffix'),
              combinationSuffix: t('combinationSuffix'),
            }}
            onSelect={(slot) => {
              const wire: SlotWire = {
                from: new Date(slot.from).toISOString(),
                to: new Date(slot.to).toISOString(),
                availableTableIds: slot.availableTableIds,
                ...(slot.availableCombinationIds
                  ? { availableCombinationIds: slot.availableCombinationIds }
                  : {}),
              }
              setSelectedSlot(wire)
              if (slot.availableTableIds.length === 0 && (slot.availableCombinationIds?.length ?? 0) > 0) {
                setSelectedTableId(null)
                setSelectedCombinationId(slot.availableCombinationIds![0] ?? null)
              } else if (slotHasSelectable(wire)) {
                // Pick-your-spot: guest chooses from the floor map below.
                setSelectedTableId(null)
                setSelectedCombinationId(null)
              } else {
                setSelectedTableId(slot.availableTableIds[0] ?? null)
                setSelectedCombinationId(null)
              }
            }}
          />
        )}
      </section>

      {selectedSlot && layout && slotHasSelectable(selectedSlot) && !selectedCombinationId ? (
        <section className="mt-5 border-t border-gray-200 pt-5">
          <FloorMapPicker
            world={layout.world}
            elements={layout.elements}
            tables={layout.tables}
            availableTableIds={selectedSlot.availableTableIds}
            selectedTableId={selectedTableId}
            partySize={partySize}
            labels={{
              heading: t('mapHeading'),
              legendAvailable: t('mapLegendAvailable'),
              legendSelected: t('mapLegendSelected'),
              legendUnavailable: t('mapLegendUnavailable'),
              reasonNotSelectable: t('mapReasonNotSelectable'),
              reasonUnavailable: t('mapReasonUnavailable'),
              reasonTooSmall: ({ capacity, partySize }) =>
                t('mapReasonTooSmall', { capacity, partySize }),
              reasonTooBig: ({ minPartySize, partySize }) =>
                t('mapReasonTooBig', { minPartySize, partySize }),
            }}
            onSelect={(id) => setSelectedTableId(id)}
          />
        </section>
      ) : null}

      {selectedSlot && (selectedTableId || selectedCombinationId) ? (
        <section className="mt-5 border-t border-gray-200 pt-5">
          {isComboPick ? (
            <p className="text-sm text-gray-600 mb-4">{t('comboNote', { partySize })}</p>
          ) : null}
          <BookingForm
            labels={{
              heading: isComboPick ? t('comboFormHeading') : t('formHeading'),
              guestName: t('fieldGuestName'),
              guestEmail: t('fieldGuestEmail'),
              guestPhone: t('fieldGuestPhone'),
              specialRequests: t('fieldSpecialRequests'),
              submit: t('submit'),
              submitting: t('submitting'),
              errorPrefix: t('errorPrefix'),
            }}
            onSubmit={submitBooking}
          />
        </section>
      ) : null}
    </Shell>
  )
}

// forwardRef so the height-reporting effect can measure the rendered tree.
const Shell = forwardRef<
  HTMLDivElement,
  { title: string; poweredBy: string; children: React.ReactNode }
>(function Shell({ title, poweredBy, children }, ref) {
  return (
    <div ref={ref} className="bg-white p-5 max-w-lg mx-auto font-sans">
      <h1 className="text-lg font-semibold text-gray-900 mb-4">{title}</h1>
      {children}
      <p className="mt-6 text-center text-[11px] text-gray-400">{poweredBy}</p>
    </div>
  )
})

function formatYmd(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
