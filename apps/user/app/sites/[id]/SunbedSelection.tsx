'use client'

import { InventoryItem, MapBounds, SiteProps, WorkingHours } from '@/app/sites/types'
import { MobileDatePicker } from '@mui/x-date-pickers/MobileDatePicker'
import { MobileDateRangePicker } from '@mui/x-date-pickers-pro/MobileDateRangePicker'
import { SingleInputDateRangeField } from '@mui/x-date-pickers-pro/SingleInputDateRangeField'
import { useEffect } from 'react'

import { setValue } from '@/store/features/sites/sitesSlice'
import { RootState } from '@/store/store'
import { useSelector, useDispatch } from 'react-redux'
import { 
  useGetAvailabilityBySiteAndTimeRangeQuery
} from '@/store/features/api/apiSlice'
import dayjs, { Dayjs } from 'dayjs'
import { APIProvider, AdvancedMarker, Map } from '@vis.gl/react-google-maps'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { SingleInputTimeRangeField } from '@mui/x-date-pickers-pro/SingleInputTimeRangeField'

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

export default function SunbedSelectionComponent({
  apiKey,
  site
}: {
  apiKey: string
  site: SiteProps
}) {

  const dispatch = useDispatch()
  const sitesState = useSelector((state: RootState) => state.sites)
  const { reservationState, reservationMode } = sitesState

  console.log('Sites state', sitesState)

  let reservationDay = sitesState.reservationDay || dayjs().toDate()
  let timeRange = sitesState.timeRange || [
    dayjs().add(2, 'hour').toDate(),
    dayjs().add(4, 'hour').toDate()
  ]

  let dateRange = sitesState.dateRange || [
    dayjs().toISOString(),
    dayjs().add(2, 'day').toISOString()
  ]

  let availabilityFrom = dateRange[0]
  let availabilityTo = dateRange[1]
  if (reservationMode === 'hours') {
    availabilityFrom = dayjs(reservationDay)
      .hour(timeRange[0]!.hour())
      .minute(timeRange[0]!.minute())
      .second(timeRange[0]!.second())
    availabilityTo = dayjs(reservationDay)
      .hour(timeRange[1]!.hour())
      .minute(timeRange[1]!.minute())
      .second(timeRange[1]!.second())
  }

  const { data: availabilityResponse, refetch: refetchAvailability } = useGetAvailabilityBySiteAndTimeRangeQuery({ 
    siteId: site.id,
    from: availabilityFrom,
    to: availabilityTo
   })
   

  console.log('Availability response', availabilityResponse)

  
  function isAvailable(item: InventoryItem): boolean {
    if (!availabilityResponse) return false
    return !!availabilityResponse.availability.find(a => a.itemId === item.id && a.available)
  }

  let inventoryItems = site.inventoryItems
  const firstAvailableItem = inventoryItems?.find(item => isAvailable(item))
  let selectedItem = sitesState.selectedItem || firstAvailableItem

  useEffect(() => {
    if (availabilityResponse) {
      console.log('Reset selected for new avaiability?', selectedItem, selectedItem && isAvailable(selectedItem))
      if ((selectedItem && !isAvailable(selectedItem)) || !selectedItem || (selectedItem && !sitesState.selectedItem)) {
        const firstAvailableItem = inventoryItems?.find(item => isAvailable(item))
        dispatch(setValue({ selectedItem: firstAvailableItem }))
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

  let notWorkingHours = false
  
  if (reservationMode === 'hours' && 
    reservationDay && availabilityFrom && availabilityTo) {
    notWorkingHours = !isSiteOpen(dayjs(reservationDay), dayjs(availabilityFrom), dayjs(availabilityTo), site.workingHours)
  }

  return (
    <>
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
                value={dayjs(reservationDay)}
                selectedSections={null}
                onOpen={() => {
                  dispatch(setValue({ focused: true }))
                }}
                onChange={(value) => {
                  dispatch(setValue({
                    reservationDay: value?.toDate(),
                    focused: true
                  }))
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
                value={[dayjs(timeRange[0]), dayjs(timeRange[1])]}
                onFocus={() => {
                  console.log('Focus')
                  dispatch(setValue({ focused: true }))
                }}
                onBlur={() => {
                  console.log('Blur')
                }}
                onChange={(newValue) => {
                  dispatch(setValue({ timeRange: [newValue[0]?.toDate(), newValue[1]?.toDate()] }))
                }}
              />
            </LocalizationProvider>
          </div>
        ) : (
          <div className="mb-2">
            <div className="mb-2 mt-2 pb-2 pt-2 text-[#1565c0]">
              Select dates and chairs
            </div>
            <LocalizationProvider dateAdapter={AdapterDayjs}>
              <MobileDateRangePicker sx={{ 
                  width: '100%',
                  input: {
                    textAlign: 'center'
                  }
                }}
                onOpen={() => {
                  dispatch(setValue({ focused: true }))
                }}
                value={[dayjs(dateRange[0]), dayjs(dateRange[1])]}
                disabled={reservationState === 'processing'}
                format='YYYY-MM-DD'
                selectedSections={null}
                label="From - To"
                slots={{ 
                  field: SingleInputDateRangeField
                }}
                onChange={(newValue) => {
                  console.log('Date range', newValue)
                  dispatch(setValue({ dateRange: [newValue[0]?.toISOString(), newValue[1]?.toISOString()] }))
                }}
              />
            </LocalizationProvider>
          </div>
        )
      }
      <div className="w-full lg:w-1/2 h-[300px]">
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
                        dispatch(setValue({ selectedItem: item }))
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
      </div>
    </>
  )

}
