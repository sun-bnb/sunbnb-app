'use client'

import { MapBounds, SiteProps } from '@/app/sites/types'
import Button from '@mui/material/Button'
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import Select, { SelectChangeEvent } from '@mui/material/Select';
import { useState } from 'react'
import { useSession } from 'next-auth/react'
import dayjs, { Dayjs } from 'dayjs'
import { APIProvider, AdvancedMarker, Map } from '@vis.gl/react-google-maps'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { DateRange } from '@mui/x-date-pickers-pro/models'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { SingleInputTimeRangeField } from '@mui/x-date-pickers-pro/SingleInputTimeRangeField'
import { saveReservation } from './actions'

export default function SiteView({ site, apiKey }: { site: SiteProps, apiKey: string }) {

  const { data: session } = useSession()

  const [ mode, setMode ] = useState('view')
  const [ focused, setFocused ] = useState(false)
  const [ selectedItem, setSelectedItem ] = useState(site.inventoryItems?.[0])
  const [ paymentMethod, setPaymentMethod ] = useState('0001')

  const [timeRange, setTimeRange] = useState<DateRange<Dayjs>>(() => [
    dayjs('2022-04-17T15:30'),
    dayjs('2022-04-17T18:30'),
  ])

  const { inventoryItems, workingHours } = site

  const itemLats = (inventoryItems || []).map(item => Number(item.locationLat));
  const itemLngs = (inventoryItems || []).map(item => Number(item.locationLng));

  const defaultBounds: MapBounds = {
    north: Math.max(...itemLats),
    south: Math.min(...itemLats),
    east: Math.max(...itemLngs),
    west: Math.min(...itemLngs)
  };

  console.log('Site', site)

  return (
    <div className="container mx-auto">
      <div>
        <div className="relative" onClick={() => {
          setFocused(false)
        }}>
          <div className="w-full border-t-2 border-t-white">
            {
              site.image &&
                <img className="w-full h-auto" src={site.image} />
            }
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-white to-transparent via-transparent h-100"></div>
          <div className="absolute top-[2px] left-[12px] text-2xl bg-black bg-opacity-30 px-2 py-1 rounded-lg text-white">
            { site.name }
          </div>
        </div>
        <div className={`relative transition-all duration-500
          ${focused ? "-mt-[160px]" : "mt-[0px]"} 
          bg-white px-2 py-4`}>
          <div className="mb-2">
            <LocalizationProvider dateAdapter={AdapterDayjs}>
              <SingleInputTimeRangeField
                label="Reserve chair: From - To"
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
                onChange={(newValue) => setTimeRange(newValue)}
              />
            </LocalizationProvider>
          </div>
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
                  ((inventoryItems || []).map(item => (
                    (item.id !== selectedItem?.id) && <AdvancedMarker key={item.id}
                      position={{ lat: Number(item.locationLat), lng: Number(item.locationLng) }}
                      onClick={() => {
                        setSelectedItem(item)
                      }}>
                      <div className="w-[40px] h-[40px] bg-yellow-200 rounded-full flex justify-center">
                        <span className="text-4xl">&#x26F1;</span>
                      </div>
                    </AdvancedMarker>)))
                }
                {
                  (selectedItem?.locationLat && selectedItem?.locationLng) &&
                    <AdvancedMarker position={{ lat: Number(selectedItem.locationLat), lng: Number(selectedItem.locationLng) }}>
                      <div className="border border-[4px] border-red-800 w-[46px] h-[46px] bg-yellow-400 rounded-full flex justify-center">
                        <span className="text-4xl">&#x26F1;</span>
                      </div>
                    </AdvancedMarker>

                }
              </Map>
            </APIProvider>
          </div>
          <div className="w-full mt-4">
            <FormControl size="medium" fullWidth={true}>
              <InputLabel>Payment method</InputLabel>
              <Select
                labelId="demo-select-small-label"
                id="demo-select-small"
                value={paymentMethod}
                label="Payment method"
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
              onClick={
                () => {
                  console.log('Reserve', timeRange)
                  if (timeRange[0] && timeRange[1]) {
                    const from = timeRange[0].toISOString()
                    const to = timeRange[1].toISOString()
                    saveReservation({
                      from: timeRange[0].toDate(),
                      to: timeRange[1].toDate(),
                      siteId: site.id!,
                      userId: session?.user?.id!
                    })
                  }
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