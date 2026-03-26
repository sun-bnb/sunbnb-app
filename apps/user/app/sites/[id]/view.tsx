'use client'

import logger from '@/utils/logger'

import { Reservation, SiteProps } from '@/app/sites/types'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import Divider from '@mui/material/Divider'
import RestaurantIcon from '@mui/icons-material/Restaurant'
import WcIcon from '@mui/icons-material/Wc'
import SurfingIcon from '@mui/icons-material/Surfing'
import LocalBarIcon from '@mui/icons-material/LocalBar'
import KeyboardDoubleArrowDownIcon from '@mui/icons-material/KeyboardDoubleArrowDown'
import KeyboardDoubleArrowUpIcon from '@mui/icons-material/KeyboardDoubleArrowUp'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import EventNoteIcon from '@mui/icons-material/EventNote'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { setValue } from '@/store/features/sites/sitesSlice'
import { RootState } from '@/store/store'
import { useDispatch, useSelector } from 'react-redux'
import dayjs from 'dayjs'
import { 
  useGetSiteByIdQuery
} from '@/store/features/api/apiSlice'

import ReservationView from './Reservation'
import { useRouter, usePathname } from 'next/navigation'

const serviceIcons: {
  [key: string]: React.ReactElement
} = {
  'wc': <WcIcon />,
  'food': <RestaurantIcon />,
  'drinks': <LocalBarIcon />,
  'rental': <SurfingIcon />
}

const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const withHours = false

const Backdrop = ({ onClick }: { onClick?: () => void }) => {
  return (
    <div
      onClick={onClick} // Optional: handle clicks to close
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.5)', // Dark transparent background
        zIndex: 10, // Ensure it's above other elements
      }}
    />
  );
}

export interface SiteViewBrand {
  brandName: string
  tagline?: string | null
  bgColor?: string | null
  fgColor?: string | null
  logoUrl?: string | null
}

export default function SiteView({ site, apiKey, stripePublicKey, brand }: { site: SiteProps, apiKey: string, stripePublicKey: string | undefined, brand?: SiteViewBrand }) {

  const router = useRouter()
  const pathname = usePathname()

  const dispatch = useDispatch()
  const sitesState = useSelector((state: RootState) => state.sites)
  const { reservationMode, pendingReservationId } = sitesState

  let focused = sitesState.focused !== undefined ? sitesState.focused : false

  const [ weekDaysOpen, setWeekDaysOpen ] = useState<boolean>(false)

  const { data: fetchedSite, refetch: refetchSite } = useGetSiteByIdQuery({ id: site.id })

  logger.debug('Fetched site', fetchedSite)

  let inventoryItems = site.inventoryItems
  
  const itemCount = inventoryItems?.length
  const availableCount = inventoryItems?.filter(item => item.status === 'active' && (item.reservations || []).length === 0).length

  let allReservations: Reservation[] = []
  if (inventoryItems) {
    allReservations = inventoryItems.flatMap(item => (item.reservations || []))
  }

  const now = dayjs()

  const siteWorkingHours = fetchedSite?.workingHours || site.workingHours || []
  const siteWeekDays = weekDaysOpen ? siteWorkingHours : siteWorkingHours?.filter(wh => wh.day === (now.day() === 0 ? 7 : now.day()))

  const whMaxHeight = weekDaysOpen ? 'max-h-[260px]' : 'max-h-[100px]'

  const t = useTranslations('SiteView')

  // ── Mobile drawer: peek height = visible portion when minimized ──
  // Heights: date range ~56px, date+time row ~48px, hours/days toggle ~36px, view mode tabs ~44px, padding ~16px
  const activeSite = fetchedSite || site
  const features = activeSite.features || ['sunbeds']
  const hasSunbeds = features.includes('sunbeds')
  const hasRentals = features.includes('rentals') && (activeSite.rentalItems?.length ?? 0) > 0
  const hasViewModeTabs = hasSunbeds && hasRentals
  const hasHourlyEquipment = hasRentals && (activeSite.rentalItems || []).some((ri: any) => ri.pricePerHour != null && ri.pricePerHour > 0)
  const viewMode = sitesState.viewMode || (hasSunbeds ? 'sunbeds' : 'equipment')
  // Sunbeds tab: date range picker (56) + padding (16) = 72
  // Equipment tab with hourly pricing, hours mode: hours/days toggle (36) + date+time picker (48) + padding (16) = 100
  // Equipment tab with hourly pricing, days mode: toggle (36) + date range (56) + padding (16) = 108
  // Equipment tab without hourly pricing: date range picker (56) + padding (16) = 72
  const currentMode = reservationMode || 'days'
  const isHourly = currentMode === 'hours'
  const isEquipmentTab = viewMode === 'equipment'
  const BASE_PEEK = isEquipmentTab && hasHourlyEquipment
    ? (isHourly ? 100 : 108)
    : 66
  const PEEK_HEIGHT = BASE_PEEK + (hasViewModeTabs ? 52 : 0)
  
  return (
    <div className={`mx-auto max-w-6xl min-h-screen ${brand ? '' : 'bg-cream pt-[80px]'}`}
      style={brand ? { backgroundColor: brand.bgColor || '#faf9f6', color: brand.fgColor || '#111827' } : undefined}
    >
      {
        focused &&
          <Backdrop onClick={() => {
            dispatch(setValue({ focused: false }))
          }} />
      }
      <div className="lg:flex lg:gap-8 lg:px-6 lg:pt-4">
        {/* Left column: site info */}
        <div className="lg:flex-[3] lg:min-w-0">
        <div className="relative overflow-hidden lg:rounded-xl" onClick={() => {
          dispatch(setValue({ focused: false }))
        }}>
          <div className={`w-full leading-[0] ${brand ? '' : 'border-t border-cream'}`}>
            {
              (site.image && site.imageWidth && site.imageHeight) && (
                brand ? (
                  <img width={site.imageWidth} height={site.imageHeight} alt={site.description || ''} className="block w-full h-auto" src={site.image} />
                ) : (
                  <Image width={site.imageWidth} height={site.imageHeight} alt={site.description || ''} className="block w-full h-auto lg:rounded-xl" src={site.image} />
                )
              )
            }
          </div>
          {brand ? (
            <>
              <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/40 to-transparent" style={{ height: '60%' }}></div>
              <div className="absolute top-3 left-3 right-14">
                <h1 className="text-2xl font-bold text-white drop-shadow-lg">{brand.brandName}</h1>
                {brand.tagline && (
                  <p className="text-sm text-white/85 mt-0.5 drop-shadow-md">{brand.tagline}</p>
                )}
              </div>
              <button
                onClick={() => {
                  const slugMatch = pathname.match(/^\/s\/([^/]+)/)
                  const target = slugMatch ? `/s/${slugMatch[1]}/reservations` : '/reservations'
                  router.push(target)
                }}
                className="absolute bottom-3 right-3 flex items-center justify-center w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm text-white hover:bg-black/60 transition-colors"
              >
                <EventNoteIcon style={{ fontSize: 20 }} />
              </button>
            </>
          ) : (
            <>
              <div className="absolute inset-0 bg-gradient-to-b from-cream to-transparent via-transparent h-100"></div>
              <div className="absolute top-2 left-3 text-2xl bg-black/30 px-3 py-1 rounded-lg text-white backdrop-blur-sm font-semibold">
                { site.name }
              </div>
            </>
          )}
        </div>
        <div className={brand ? 'px-3' : 'py-3 px-3'}>
          <div className={`flex justify-between items-center ${brand ? 'bg-black/30 -mx-3 px-3 py-2' : ''}`}>
            <div className="flex items-center gap-3 text-sm">
              <div>
                <span className="mr-1">&#x26F1;</span>
                <span className={brand ? 'text-green-400 font-medium' : (availableCount || 0) > 0 ? 'text-green-600 font-medium' : 'text-red-500 font-medium'}>{availableCount}</span>
                <span className={brand ? 'text-white/50 mx-px' : 'text-gray-300 mx-px'}>/</span>
                <span className={brand ? 'text-white/60' : 'text-gray-400'}>{itemCount}</span>
              </div>
              {
                site.distance &&
                  <div className={brand ? 'text-white/90' : 'text-gray-600'}>
                    <span className="mr-px">{Math.round(site.distance)}</span>
                    <span className={`text-xs ${brand ? 'text-white/60' : 'text-gray-400'}`}>KM</span>
                  </div>
              }
              {
                site.price &&
                  <div className={brand ? 'text-white font-medium' : 'text-gray-700 font-medium'}>
                    <span>&#8364;</span>
                    <span>{site.price}</span>
                  </div>
              }
            </div>
            <div className="flex gap-1">
              {
                (site.services || []).map(service => {
                  return (
                    <div key={`service-${service}`} className={brand ? 'border border-white/30 rounded-md px-1 py-px text-white/80' : 'border border-gray-200 rounded-md px-1 py-px text-gray-500'}>
                      <div className="-mt-px">
                        { serviceIcons[service] }
                      </div>
                    </div>
                  )
                })
              }
            </div>
          </div>
          <div className={`pt-2 text-sm leading-relaxed ${brand ? 'mt-2' : 'text-gray-600'}`}>
            { site.description }
          </div>
          <div className={`pt-3 ${whMaxHeight} overflow-hidden`}>
            <Divider textAlign="left">
              <span className="text-sm font-bold">{t('OPENING HOURS')}</span>
            </Divider>
            {
              siteWeekDays.map(wh => {
                const currentDay = now.day() === 0 ? 7 : now.day()
                const isCurrentDay = currentDay === wh.day
                return (
                  <div key={wh.id} className={`flex justify-between ${isCurrentDay ? 'font-bold' : ''}`}>
                    <div>{weekDays[wh.day - 1]}</div>
                    <div>{dayjs(wh.openTime).format('HH:mm')} - {dayjs(wh.closeTime).format('HH:mm')}</div>
                  </div>
                )
              })
            }
            <Divider textAlign="center">
              <span className="text-sm font-bold">
                {
                  weekDaysOpen ? 
                    <ExpandLessIcon sx={{ marginTop: '-4px' }}
                      onClick={() => setWeekDaysOpen(false) }/> :
                    <ExpandMoreIcon sx={{ marginTop: '-4px' }}
                      onClick={() => setWeekDaysOpen(true) }/>

                }
                
              </span>
            </Divider>
          </div>
        </div>
        </div>
        {/* Right column: reservation panel — sticky sidebar on desktop, fixed drawer on mobile */}
        <div className="hidden lg:block lg:flex-[2] lg:min-w-[360px] lg:max-w-[480px]">
          <div className={`lg:sticky lg:top-[80px] px-3 pb-4 ${brand ? '' : 'bg-cream'}`}
            style={brand ? { backgroundColor: brand.bgColor || '#faf9f6' } : undefined}
          >
            {
                withHours ?
            <div className="w-full">

                  <div className="mb-4">
                    <Tabs variant="fullWidth" value={reservationMode || 'days'} onChange={(e, value) => {
                      dispatch(setValue({
                        reservationMode: value,
                        focused: true
                      }))
                    }} aria-label="Reservation mode">
                      <Tab value="days" label={t('Days')} />
                      <Tab value="hours" label={t('Hours')} />
                    </Tabs>
                  </div>

            </div> : null
            }
            <ReservationView apiKey={apiKey} stripePublicKey={stripePublicKey} site={fetchedSite || site} wide={true} />
          </div>
        </div>
      </div>
        {/* Mobile spacer to prevent content from hiding behind the fixed drawer */}
        <div className="lg:hidden" style={{ height: `${PEEK_HEIGHT + 16}px` }} />

        {/* ── Mobile reservation drawer ── */}
        <div
          className={`lg:hidden fixed left-0 w-full text-center border-t transition-transform duration-500 ease-in-out ${brand ? '' : 'bg-cream text-white border-subtle'}`}
          style={{
            zIndex: 11,
            bottom: 0,
            transform: focused ? 'translateY(0)' : `translateY(calc(100% - ${PEEK_HEIGHT}px))`,
            ...(brand ? { backgroundColor: brand.bgColor || '#faf9f6', color: brand.fgColor || '#111827', borderColor: `${brand.fgColor || '#111827'}15` } : {}),
          }}
        >
          {/* Minimize / maximize pill button */}
          {(focused || pendingReservationId) && (
            <div
              className="text-black absolute w-[100px] rounded-full border shadow-soft cursor-pointer"
              style={{
                left: 'calc(50% - 50px)',
                top: '-15px',
                zIndex: 2,
                ...(brand
                  ? { backgroundColor: brand.bgColor || '#faf9f6', borderColor: `${brand.fgColor || '#111827'}15`, color: brand.fgColor || '#111827' }
                  : { backgroundColor: 'var(--color-cream, #faf9f6)', borderColor: 'var(--color-subtle, #e5e7eb)' }),
              }}
              onClick={() => dispatch(setValue({ focused: !focused }))}
            >
              {focused ? <KeyboardDoubleArrowDownIcon /> : <KeyboardDoubleArrowUpIcon />}
            </div>
          )}

          {/* Drawer content: date range field stays visible as peek, rest scrolls off */}
          <div className={`px-3 ${focused ? 'pt-4 pb-4' : 'pt-0 pb-1'}`}>
            {withHours && (
              <div className="w-full mb-4">
                <Tabs variant="fullWidth" value={reservationMode || 'days'} onChange={(e, value) => {
                  dispatch(setValue({ reservationMode: value, focused: true }))
                }} aria-label="Reservation mode">
                  <Tab value="days" label={t('Days')} />
                  <Tab value="hours" label={t('Hours')} />
                </Tabs>
              </div>
            )}
            <ReservationView apiKey={apiKey} stripePublicKey={stripePublicKey} site={fetchedSite || site} />
          </div>
        </div>
    </div>
  )

}