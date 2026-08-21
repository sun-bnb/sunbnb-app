'use client'

import { useEffect } from 'react'
import dayjs from 'dayjs'
import { useDispatch, useSelector } from 'react-redux'

import { SiteProps } from '@/app/sites/types'
import { RootState } from '@/store/store'
import { setValue } from '@/store/features/sites/sitesSlice'
import ReservationView from '@/app/sites/[id]/Reservation'
import KeyboardDoubleArrowDownIcon from '@mui/icons-material/KeyboardDoubleArrowDown'
import KeyboardDoubleArrowUpIcon from '@mui/icons-material/KeyboardDoubleArrowUp'

import { peekHeight } from '@/app/sites/[id]/peek-height'

/**
 * The booking funnel as ONE mountable component (track 023 P2).
 *
 * Everything a guest uses to actually book — the date range, seat selection,
 * equipment, the price and the Reserve button — plus the responsive shell
 * around it: a sticky sidebar at `lg`, a fixed peek-and-expand drawer below it,
 * the scrim, and the minimise pill.
 *
 * **Why it is a component rather than part of the page.** A custom brand page
 * (track 023) owns its own layout, and the one thing it must NOT own is the
 * funnel: a bespoke shell that copies the drawer inherits a copy that stops
 * matching the day the payment step, the seat-selection policy or the drawer
 * mechanics change. Brands mount this instead, and an engine change reaches
 * every shell at once.
 *
 * **Contract.** Give it a site, a Maps key, and optionally the two colours that
 * make it sit inside a branded page. It reads and writes the `sites` slice
 * (`focused`, `reservationDay`, `reservationMode`, `viewMode`) — that is
 * deliberate and is why it needs no callbacks: the panel, the map and the seat
 * canvas all coordinate through that slice already.
 *
 * **Placement.** It renders its own desktop column, the mobile spacer and the
 * fixed drawer as siblings. Put it inside a flex row for the sidebar to sit
 * beside the page content; the drawer and scrim are `position: fixed` and land
 * correctly wherever it is mounted.
 */

/**
 * The only two brand values the funnel needs. Deliberately NOT `SiteViewBrand`:
 * the funnel does not care about a brand name, a tagline or a logo, and taking
 * the whole object would tie this component to whatever that shape becomes.
 */
export interface BookingTheme {
  background?: string | null
  foreground?: string | null
}

const DEFAULT_BACKGROUND = '#faf9f6'
const DEFAULT_FOREGROUND = '#111827'

const Backdrop = ({ onClick }: { onClick?: () => void }) => {
  return (
    <div
      onClick={onClick}
      // Mobile-only scrim: it pairs with the lg:hidden reservation drawer (z-11).
      // On desktop there is no drawer — the reservation panel is the sticky
      // sidebar (no elevated z-index), so an un-guarded backdrop would shadow and
      // disable the whole page until clicked. Switching the Equipment tab sets
      // `focused: true`, which is what surfaced this. Keep it hidden at lg+.
      className="lg:hidden"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        zIndex: 10,
      }}
    />
  )
}

export default function BookingSurface({
  site,
  apiKey,
  theme,
}: {
  site: SiteProps
  apiKey: string
  theme?: BookingTheme
}) {
  const dispatch = useDispatch()
  const sitesState = useSelector((state: RootState) => state.sites)
  const { reservationMode, pendingReservationId } = sitesState

  const focused = sitesState.focused !== undefined ? sitesState.focused : false

  // On mount, open the drawer expanded and commit today as the default
  // reservationDay so downstream components (SunbedSelection, ReservationView)
  // see a real committed value rather than a render-time fallback (track 014).
  // Runs once per mount — if the guest collapses the drawer afterwards it stays
  // collapsed; `focused: true` is never forced again.
  useEffect(() => {
    const updates: Record<string, unknown> = { focused: true }
    if (!sitesState.reservationDay) {
      updates.reservationDay = dayjs().toDate()
    }
    dispatch(setValue(updates))
  }, [])

  const features = site.features ?? ['sunbeds']
  const hasSunbeds = features.includes('sunbeds')
  const hasRentals = features.includes('rentals') && (site.rentalItems?.length ?? 0) > 0
  const hasHourlyEquipment =
    hasRentals && (site.rentalItems || []).some((ri: any) => ri.pricePerHour != null && ri.pricePerHour > 0)

  const PEEK_HEIGHT = peekHeight({
    viewMode: sitesState.viewMode || (hasSunbeds ? 'sunbeds' : 'equipment'),
    reservationMode: reservationMode || 'days',
    hasHourlyEquipment,
    hasViewModeTabs: hasSunbeds && hasRentals,
  })

  const background = theme ? theme.background || DEFAULT_BACKGROUND : undefined
  const foreground = theme ? theme.foreground || DEFAULT_FOREGROUND : undefined

  return (
    <>
      {
        // Scrim shows whenever the drawer is open, including the initial
        // auto-open — it frames the reservation panel and lets a background tap
        // dismiss it.
        focused && <Backdrop onClick={() => dispatch(setValue({ focused: false }))} />
      }

      {/* Desktop: sticky sidebar beside the page content */}
      <div className="hidden lg:block lg:flex-[2] lg:min-w-[360px] lg:max-w-[480px]">
        <div
          className={`lg:sticky lg:top-[80px] px-3 pb-4 ${theme ? '' : 'bg-cream'}`}
          style={theme ? { backgroundColor: background } : undefined}
        >
          <ReservationView apiKey={apiKey} site={site} wide={true} />
        </div>
      </div>

      {/* Mobile spacer so page content is not hidden behind the fixed drawer */}
      <div className="lg:hidden" style={{ height: `${PEEK_HEIGHT + 16}px` }} />

      {/* Mobile: fixed peek-and-expand drawer */}
      <div
        className={`lg:hidden fixed left-0 w-full text-center border-t transition-transform duration-500 ease-in-out ${
          theme ? '' : 'bg-cream text-white border-subtle'
        }`}
        style={{
          zIndex: 11,
          bottom: 0,
          transform: focused ? 'translateY(0)' : `translateY(calc(100% - ${PEEK_HEIGHT}px))`,
          ...(theme
            ? { backgroundColor: background, color: foreground, borderColor: `${foreground}15` }
            : {}),
        }}
      >
        {/* Minimise / maximise pill */}
        {(focused || pendingReservationId) && (
          <div
            className="text-black absolute w-[100px] rounded-full border shadow-soft cursor-pointer"
            style={{
              left: 'calc(50% - 50px)',
              top: '-15px',
              zIndex: 2,
              ...(theme
                ? { backgroundColor: background, borderColor: `${foreground}15`, color: foreground }
                : {
                    backgroundColor: 'var(--color-cream, #faf9f6)',
                    borderColor: 'var(--color-subtle, #e5e7eb)',
                  }),
            }}
            onClick={() => dispatch(setValue({ focused: !focused }))}
          >
            {focused ? <KeyboardDoubleArrowDownIcon /> : <KeyboardDoubleArrowUpIcon />}
          </div>
        )}

        {/* Drawer content: the date field stays visible as peek, the rest scrolls off */}
        <div className={`px-3 ${focused ? 'pt-4 pb-4' : 'pt-0 pb-1'}`}>
          <ReservationView apiKey={apiKey} site={site} />
        </div>
      </div>
    </>
  )
}
