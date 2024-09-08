'use client'

import { InventoryItem, MapBounds, Reservation, SiteProps, WorkingHours } from '@/app/sites/types'
import Button from '@mui/material/Button'
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import Tabs from '@mui/material/Tabs';
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
import { useRouter } from 'next/navigation';

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

function isSiteOpen(reservationDay: Dayjs, from: Dayjs, to: Dayjs, workingHours: WorkingHours[] | undefined): boolean {

  let notWorkingHours = false
    const reservationWeekDay = reservationDay.day() === 0 ? 7 : reservationDay.day()
    const rdOpeningHours = (workingHours || [])
      .find(wh => wh.day === reservationWeekDay)
    
    const openTime = new Date(rdOpeningHours?.openTime || 0)
    const closeTime = new Date(rdOpeningHours?.closeTime || 0)
    
    const openFrom = reservationDay.hour(openTime.getHours()).minute(openTime.getMinutes())
    const openTo = reservationDay.hour(closeTime.getHours()).minute(closeTime.getMinutes())
    notWorkingHours = !rdOpeningHours || dayjs(openFrom).isAfter(from) 
      || dayjs(openTo).isBefore(to)

  return !notWorkingHours

}

export default function SiteView({ site, apiKey }: { site: SiteProps, apiKey: string }) {

  const { data: session } = useSession()

  const router = useRouter()

  const [ reservationState, setReservationState ] = useState<string>('initial')
  const [ pendingReservationId, setPendingReservationId ] = useState<string | null>(null)

  const [ reservationMode, setReservationMode ] = useState('hours')
  const [ focused, setFocused ] = useState(false)
  
  const [ paymentMethod, setPaymentMethod ] = useState('0001')

  const [ weekDaysOpen, setWeekDaysOpen ] = useState<boolean>(false)

  const [isPolling, setIsPolling] = useState(false);

  // Conditionally start polling when `isPolling` is true
  const { data, error, isLoading } = useGetReservationByIdQuery({ id: pendingReservationId }, {
    pollingInterval: isPolling ? 3000 : 0, // Poll every 3 seconds if isPolling is true
    skip: !isPolling // Skip the query entirely if isPolling is false
  })

  const { data: fetchedSite, refetch: refetchSite } = useGetSiteByIdQuery({ id: site.id })

  useEffect(() => {
    console.log('Reservation STATE', data?.status)
    if (data?.status === 'confirmed') {
      setIsPolling(false)
      setFocused(false)
      setReservationState('confirmed')
      refetchSite().then(() => {
        console.log('Refetched site')
      })
    }
  }, [data?.status])

  console.log('Reservation data', data, error, isLoading, fetchedSite)

  const [ reservationDay, setReservationDay ] = useState<Dayjs | null>(dayjs())
  const [ timeRange, setTimeRange ] = useState<DateRange<Dayjs>>(() => [
    dayjs().add(2, 'hour'),
    dayjs().add(4, 'hour')
  ])

  const [ dateRange, setDateRange ] = useState<DateRange<Dayjs>>(() => [
    dayjs(),
    dayjs().add(2, 'day')
  ])

  let availabilityFrom = dateRange[0]
  let availabilityTo = dateRange[1]
  if (reservationMode === 'hours') {
    availabilityFrom = reservationDay!
      .hour(timeRange[0]!.hour())
      .minute(timeRange[0]!.minute())
      .second(timeRange[0]!.second())
    availabilityTo = reservationDay!
      .hour(timeRange[1]!.hour())
      .minute(timeRange[1]!.minute())
      .second(timeRange[1]!.second())
  }

  const { data: availabilityResponse, refetch: refetchAvailability } = useGetAvailabilityBySiteAndTimeRangeQuery({ 
    siteId: site.id,
    from: availabilityFrom?.toDate().toISOString(),
    to: availabilityTo?.toDate().toISOString()
   }, {
    skip: !availabilityFrom || !availabilityTo
   })

  console.log('Availability response', availabilityResponse)

  function isAvailable(item: InventoryItem): boolean {
    if (!availabilityResponse) return false
    return !!availabilityResponse.availability.find(a => a.itemId === item.id && a.available)
  }

  let inventoryItems = fetchedSite?.inventoryItems || site.inventoryItems
  const firstAvailableItem = inventoryItems?.find(item => isAvailable(item))
  const [ selectedItem, setSelectedItem ] = useState<InventoryItem | undefined>(firstAvailableItem)

  useEffect(() => {
    if (availabilityResponse) {
      console.log('Reset selected for new avaiability?', selectedItem, selectedItem && isAvailable(selectedItem))
      if ((selectedItem && !isAvailable(selectedItem)) || !selectedItem) {
        const firstAvailableItem = inventoryItems?.find(item => isAvailable(item))
        setSelectedItem(firstAvailableItem)
        console.log('Reset selected for new avaiability', firstAvailableItem)
      }
    }
  }, [availabilityResponse])

  const itemLats = (inventoryItems || []).map(item => Number(item.locationLat));
  const itemLngs = (inventoryItems || []).map(item => Number(item.locationLng));

  const defaultBounds: MapBounds = {
    north: Math.max(...itemLats),
    south: Math.min(...itemLats),
    east: Math.max(...itemLngs),
    west: Math.min(...itemLngs)
  };

  const itemCount = inventoryItems?.length
  const availableCount = inventoryItems?.filter(item => item.status == 'available').length

  let allReservations: Reservation[] = []
  if (inventoryItems) {
    allReservations = inventoryItems.flatMap(item => item.reservations)
  }

  let notWorkingHours = false
  
  if (reservationMode === 'hours' && 
    reservationDay && availabilityFrom && availabilityTo) {
    notWorkingHours = !isSiteOpen(reservationDay, availabilityFrom, availabilityTo, fetchedSite?.workingHours || site.workingHours)
  }

  console.log('Site', site, allReservations)

  const confirmationElem = (
    <div className="w-full text-gray-600">
      <div className="w-full mt-6 mb-6">
        <div className="w-full flex justify-center">PAYMENT CONFIRMATION AND PROCESSING</div>
        <div className="w-full flex justify-center">WILL HAPPEN HERE</div>
      </div>
      <div className="w-full flex justify-center">
        <CircularProgress />
      </div>
      <div className="w-full mt-6">
        <div className="w-full flex justify-center">THIS IS SIMULATION :&#41;</div>
      </div>
    </div>
  )

  const now = dayjs()

  const siteWorkingHours = fetchedSite?.workingHours || site.workingHours || []
  const siteWeekDays = weekDaysOpen ? siteWorkingHours : siteWorkingHours?.filter(wh => wh.day === (now.day() === 0 ? 7 : now.day()))

  const whMaxHeight = weekDaysOpen ? 'max-h-[260px]' : 'max-h-[72px]'

  return (
    <div className="container mx-auto">
      <div>
        <div className="relative h-[245px] overflow-hidden" onClick={() => {
          setFocused(false)
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
        <div className={`fixed left-0 w-full bg-white text-white text-center px-2 pb-4
          ${!focused ? '-bottom-[433px]' : 'bottom-[0px]'} border-t transition-bottom duration-500`}>
          {
            focused &&
              <div className="text-black absolute w-[100px] bg-white rounded-md border" style={{
                left: 'calc(50% - 50px)',
                top: '-10px',
                zIndex: 2
              }}
              onClick={() => {
                setFocused(false)
              }}>
                <KeyboardDoubleArrowDownIcon />
              </div>
          }
          
          <div className="w-full">
            <div className="mb-4">
              <Tabs variant="fullWidth" value={reservationMode} onChange={(e, value) => {
                setFocused(true)
                setReservationMode(value)
              }} aria-label="Reservation mode">
                <Tab value="hours" label="Hours" />
                <Tab value="days" label="Days" />
              </Tabs>
            </div>
            {
              reservationMode === 'hours' ? (
                <div className="mb-2 flex">
                  <LocalizationProvider dateAdapter={AdapterDayjs}>
                    <MobileDatePicker sx={{ 
                      marginRight: '4px',
                      input: {
                        textAlign: 'center'
                      }
                    }}
                      disabled={reservationState === 'processing'}
                      label="Date"
                      format='YYYY-MM-DD'
                      value={reservationDay}
                      selectedSections={null}
                      onOpen={() => {
                        setFocused(true)
                      }}
                      onChange={(value) => {
                        setReservationDay(value)
                        setFocused(true)
                      }}
                    />
                    <SingleInputTimeRangeField sx={{
                      input: {
                        textAlign: 'center'
                      }
                    }}
                      label="Time"
                      disabled={reservationState === 'processing'}
                      ampm={false}
                      fullWidth={true}
                      value={timeRange}
                      onFocus={() => {
                        console.log('Focus')
                        setFocused(true)
                      }}
                      onBlur={() => {
                        console.log('Blur')
                      }}
                      onChange={(newValue) => {
                        setTimeRange(newValue)
                      }}
                    />
                  </LocalizationProvider>
                </div>
              ) : (
                <div className="mb-2 flex">
                  <LocalizationProvider dateAdapter={AdapterDayjs}>
                    <MobileDateRangePicker sx={{ 
                        width: '100%',
                        input: {
                          textAlign: 'center'
                        }
                      }}
                      onOpen={() => {
                        setFocused(true)
                      }}
                      value={dateRange}
                      disabled={reservationState === 'processing'}
                      format='YYYY-MM-DD'
                      selectedSections={null}
                      label="From - To"
                      slots={{ 
                        field: SingleInputDateRangeField
                      }}
                      onChange={(newValue) => setDateRange(newValue)}
                    />
                  </LocalizationProvider>
                </div>
              )
            }
            
          </div>
          <div className="w-full lg:w-1/2 h-[300px]">
            {
              reservationState === 'processing' ?
                confirmationElem :
            <APIProvider apiKey={apiKey}>
              <Map mapId={'7a0196a7ba317ea5'}
                defaultZoom={defaultBounds ? undefined : 20}
                defaultCenter={{ lat: Number(site.locationLat), lng: Number(site.locationLng) }}
                defaultBounds={defaultBounds}
                gestureHandling={'greedy'}
                disableDefaultUI={true}
                onClick={(e) => {
                  console.log('Map click', e)
                }}
              >
                {
                  ((inventoryItems || []).map(item => {

                    let bgColor = 'bg-gray-200'
                    let borderStyle = ''
                    let size = 40
                    const itemAvailable = !notWorkingHours && isAvailable(item)
                    if (itemAvailable) {
                      bgColor = 'bg-yellow-200'
                      if (selectedItem && selectedItem.id === item.id) {
                        bgColor = 'bg-yellow-400'
                        borderStyle = 'border border-[4px] border-red-800'
                        size = 46
                      }
                    }
                    
                    return (
                      <AdvancedMarker key={item.id}
                        position={{ lat: Number(item.locationLat), lng: Number(item.locationLng) }}
                        onClick={() => {
                          if (itemAvailable) {
                            setSelectedItem(item)
                          }
                        }}>
                        
                        <div className={`w-[${size}px] h-[${size}px] ${bgColor} ${borderStyle} rounded-full flex justify-center`}>
                          <span className="text-4xl">&#x26F1;</span>
                        </div>
                      </AdvancedMarker>
                    )}))
                }
              </Map>
            </APIProvider>
          }
          </div>
          <div className="w-full mt-4">
            <FormControl size="medium" fullWidth={true}>
              <InputLabel>Payment method</InputLabel>
              <Select
                labelId="demo-select-small-label"
                id="demo-select-small"
                value={paymentMethod}
                label="Payment method"
                disabled={reservationState === 'processing'}
                onChange={(...args) => {
                  console.log('Payment method', args)
                }}
                MenuProps={{
                  sx: {
                    transform: "translateX(-8px)", // Move the dropdown 10px to the left
                  }
                }}
                sx={{
                  '& .MuiSelect-select': {
                    display: 'flex',
                    justifyContent: 'center'
                  }
                 }}
              >
                
                <MenuItem value={'0001'} sx={{ display: 'flex', justifyContent: 'center' }}>VISA 4398 1206 7404 9258</MenuItem>
                <MenuItem value="" sx={{ display: 'flex', justifyContent: 'center' }}>
                  <em>+ Add payment method</em>
                </MenuItem>
              </Select>
            </FormControl>
          </div>
          <div className="mt-[10px]">
            <Button variant="contained" 
              fullWidth={true}
              disabled={
                (reservationState === 'processing' || reservationState === 'saving') ||
                !selectedItem
              }
              onClick={
                async () => {

                  setReservationState('saving')
                  console.log('Reserve', timeRange, selectedItem)

                  let saveResult = null
                  if (reservationMode === 'hours' && reservationDay && timeRange[0] && timeRange[1]) {
                    const from = reservationDay
                      .hour(timeRange[0].hour())
                      .minute(timeRange[0].minute())
                      .second(timeRange[0].second())
                      .toDate()
                    const to = reservationDay
                      .hour(timeRange[1].hour())
                      .minute(timeRange[1].minute())
                      .second(timeRange[1].second())
                      .toDate()
                    saveResult = await saveReservation({
                      from,
                      to,
                      type: 'hours',
                      siteId: site.id!,
                      itemId: selectedItem?.id!,
                      userId: session?.user?.id!
                    })
                  } else if (reservationMode === 'days' && dateRange[0] && dateRange[1]) {
                    const from = dateRange[0].toDate()
                    const to = dateRange[1].toDate()
                    saveResult = await saveReservation({
                      from,
                      to,
                      type: 'days',
                      siteId: site.id!,
                      itemId: selectedItem?.id!,
                      userId: session?.user?.id!
                    })
                  }

                  console.log('Save result', saveResult)
                  if (saveResult?.status === 'ok' && saveResult.id) {
                    setReservationState('processing')
                    setPendingReservationId(saveResult.id)
                    setIsPolling(true)
                  }

                  refetchAvailability().then(() => {
                    console.log('Refetched availability')
                  })

                }
              }>
                Reserve
              </Button>
          </div>
        </div>
        
      </div>
    </div>
  )

}