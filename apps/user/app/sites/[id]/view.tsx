'use client'

import { InventoryItem, MapBounds, Reservation, SiteProps, WorkingHours } from '@/app/sites/types'
import Button from '@mui/material/Button'
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import Divider from '@mui/material/Divider'
import { MobileDatePicker } from '@mui/x-date-pickers/MobileDatePicker'
import { MobileDateRangePicker } from '@mui/x-date-pickers-pro/MobileDateRangePicker'
import { SingleInputDateRangeField } from '@mui/x-date-pickers-pro/SingleInputDateRangeField'
import Select from '@mui/material/Select'
import Chip from '@mui/material/Chip'
import RestaurantIcon from '@mui/icons-material/Restaurant'
import WcIcon from '@mui/icons-material/Wc'
import SurfingIcon from '@mui/icons-material/Surfing'
import LocalBarIcon from '@mui/icons-material/LocalBar'
import CircularProgress from '@mui/material/CircularProgress'
import KeyboardDoubleArrowDownIcon from '@mui/icons-material/KeyboardDoubleArrowDown'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import Image from 'next/image'
import { useActionState, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { setValue } from '@/store/features/sites/sitesSlice'
import { RootState } from '@/store/store'
import { useDispatch, useSelector } from 'react-redux'
import dayjs, { Dayjs } from 'dayjs'
import { APIProvider, AdvancedMarker, Map } from '@vis.gl/react-google-maps'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { DateRange } from '@mui/x-date-pickers-pro/models'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { SingleInputTimeRangeField } from '@mui/x-date-pickers-pro/SingleInputTimeRangeField'
import { saveReservation } from './actions'
import { 
  useGetAvailabilityBySiteAndTimeRangeQuery,
  useGetReservationByIdQuery,
  useGetSiteByIdQuery
} from '@/store/features/api/apiSlice'

import PaymentView from '@/app/payment/Payment'
import ReservationView from './Reservation'
import { useRouter } from 'next/navigation'

const statusToChipColor: {
  [key: string]: 'default' | 'success' | 'error'
} = {
  'pending': 'default',
  'confirmed': 'success',
  'canceled': 'error'
}

const statusToChipLabel: {
  [key: string]: 'Pending' | 'Confirmed' | 'Canceled'
} = {
  'pending': 'Pending',
  'confirmed': 'Confirmed',
  'canceled': 'Canceled'
}

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

export default function SiteView({ site, apiKey, stripePublicKey  }: { site: SiteProps, apiKey: string, stripePublicKey: string | undefined }) {

  const router = useRouter()

  const dispatch = useDispatch()
  const sitesState = useSelector((state: RootState) => state.sites)
  const { reservationMode } = sitesState

  let focused = sitesState.focused !== undefined ? sitesState.focused : false

  const [ weekDaysOpen, setWeekDaysOpen ] = useState<boolean>(false)

  const { data: fetchedSite, refetch: refetchSite } = useGetSiteByIdQuery({ id: site.id })

  console.log('Fetched site', fetchedSite, process.env.APP_URL)

  let inventoryItems = site.inventoryItems
  
  const itemCount = inventoryItems?.length
  const availableCount = inventoryItems?.filter(item => item.status == 'available').length

  let allReservations: Reservation[] = []
  if (inventoryItems) {
    allReservations = inventoryItems.flatMap(item => item.reservations)
  }

  console.log('Site', site, allReservations)

  const now = dayjs()

  const siteWorkingHours = fetchedSite?.workingHours || site.workingHours || []
  const siteWeekDays = weekDaysOpen ? siteWorkingHours : siteWorkingHours?.filter(wh => wh.day === (now.day() === 0 ? 7 : now.day()))

  const whMaxHeight = weekDaysOpen ? 'max-h-[260px]' : 'max-h-[72px]'

  return (
    <div className="container mx-auto">
      {
        focused &&
          <Backdrop onClick={() => {
            dispatch(setValue({ focused: false }))
          }} />
      }
      <div>
        <div className="relative h-[245px] overflow-hidden" onClick={() => {
          dispatch(setValue({ focused: false }))
        }}>
          <div className="w-full border-t-2 border-t-white">
            {
              (site.image && site.imageWidth && site.imageHeight) &&
                <Image width={site.imageWidth} height={site.imageHeight} alt={site.description || ''} className="w-full h-auto" src={site.image} />
            }
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-white to-transparent via-transparent h-100"></div>
          <div className="absolute top-[2px] left-[12px] text-2xl bg-black bg-opacity-30 px-2 py-1 rounded-lg text-white">
            { site.name }
          </div>
        </div>
        <div className="py-3 px-2">
          <div className="px-1 flex justify-between">
            <div className="flex">
              <div className="mr-3 pl-1">
                <span className="mr-1">&#x26F1;</span>
                <span className={(availableCount || 0) > 0 ? 'text-green-600' : 'text-red-600'}>{availableCount}</span>
                <span className="text-gray-400 mx-[1px]">/</span>
                <span className="text-gray-400">{itemCount}</span>
              </div>
              {
                site.distance &&
                  <div className="mr-3">
                    <span className="mr-[2px]">{Math.round(site.distance)}</span>
                    <span className="text-xs">KM</span>
                  </div>
              }
              {
                site.price &&
                  <div className="mr-3">
                    <span>&#8364;</span>
                    <span>{site.price}</span>
                  </div>
              }
            </div>
            <div className="flex">
              {
                (site.services || []).map(service => {
                  return (
                    <div key={`service-${service}`} className="mr-1 border border-gray-600 rounded-md pr-[5px] pl-[4px]">
                      <div className="-mt-[2px]">
                        { serviceIcons[service] }
                      </div>
                    </div>
                  )
                })
              }
            </div>
          </div>
          <div className="px-1 py-2">
            { site.description }
          </div>
          {
            allReservations.length > 0 &&
              <div className="mt-2">
                <Divider textAlign="left">
                  <span className="text-sm font-bold">YOUR RESERVATIONS</span>
                </Divider>
                {
                  allReservations.map(reservation => {
                    let reservationElem = null
                    if (reservation.type === 'hours') {
                      const formattedDate = dayjs(reservation.from).format('ddd, D MMM YYYY')
                      const timeRangeFrom = `${dayjs(reservation.from).format('HH:mm')}`
                      const timeRangeTo = `${dayjs(reservation.to).format('HH:mm')}`
                      reservationElem = (
                        <div className="flex px-1 justify-between align-center mt-2 pb-1" onClick={() => {
                          router.push(`/reservations/${reservation.id}`)
                        }}>
                          <div className="flex text-sm">
                            <div className="mr-4">{formattedDate}</div>
                            <div className="flex text-gray-600">
                              <div className="mr-1">{timeRangeFrom}</div>
                              <div>-</div>
                              <div className="ml-1">{timeRangeTo}</div>
                            </div>
                          </div>
                          <div className="-mt-1">
                            <Chip color={statusToChipColor[reservation.status]} 
                              label={statusToChipLabel[reservation.status]} 
                              sx={{ height: '26px' }} />
                          </div>
                        </div>
                      )
                    } else {
                      const dateRangeFrom = dayjs(reservation.from).format('ddd, D MMM YYYY')
                      const dateRangeTo = dayjs(reservation.to).format('ddd, D MMM YYYY')
                      reservationElem = (
                        <div className="flex px-1 justify-between align-center mt-2 pb-1" onClick={() => {
                          router.push(`/reservations/${reservation.id}`)
                        }}>
                          <div className="text-sm">
                            <div className="flex">
                              <div className="mr-1">{dateRangeFrom}</div>
                              <div>-</div>
                              <div className="ml-1">{dateRangeTo}</div>
                            </div>
                          </div>
                          <div className="-mt-1">
                            <Chip color={statusToChipColor[reservation.status]} 
                              label={statusToChipLabel[reservation.status]}
                              sx={{ height: '26px' }} />
                          </div>
                        </div>
                      )
                    }
                    return (
                      <div key={reservation.id}>{reservationElem}</div>
                    )
                  })
                }
              </div>
          }
          <div className={`px-1 py-2 ${whMaxHeight} overflow-hidden`}>
            <Divider textAlign="left">
              <span className="text-sm font-bold">OPENING HOURS</span>
            </Divider>
            {
              siteWeekDays.map(wh => {
                const currentDay = now.day() === 0 ? 7 : now.day()
                const isCurrentDay = currentDay === wh.day
                console.log('Current day', currentDay, wh.day, isCurrentDay)
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
        <div className="mt-[140px]">
        </div>
        <div style={{ zIndex: 11 }} className={`fixed left-0 w-full bg-white text-white text-center px-2 pb-4
          ${!focused ? '-bottom-[364px]' : 'bottom-[0px]'} border-t transition-bottom duration-500`}>
          {
            focused &&
              <div className="text-black absolute w-[100px] bg-white rounded-md border" style={{
                left: 'calc(50% - 50px)',
                top: '-15px',
                zIndex: 2
              }}
              onClick={() => {
                dispatch(setValue({ focused: false }))
              }}>
                <KeyboardDoubleArrowDownIcon />
              </div>
          }
          
              <div className="w-full">
                {
                  withHours ?
                    <div className="mb-4">
                      <Tabs variant="fullWidth" value={reservationMode} onChange={(e, value) => {
                        dispatch(setValue({ 
                          reservationMode: value,
                          focused: true 
                        }))
                      }} aria-label="Reservation mode">
                        <Tab value="hours" label="Hours" />
                        <Tab value="days" label="Days" />
                      </Tabs>
                    </div> :
                    <div className="mb-4">
                    </div>
                }
              </div>
              <ReservationView apiKey={apiKey} stripePublicKey={stripePublicKey} site={fetchedSite || site} />
        </div>
        
      </div>
    </div>
  )

}