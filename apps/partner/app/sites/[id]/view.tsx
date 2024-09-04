'use client'


import { useFormState, useFormStatus } from 'react-dom'
import React, { ReactElement, useState } from 'react'
import { APIProvider, ControlPosition, Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Divider from '@mui/material/Divider'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Chip from '@mui/material/Chip'

import { SiteProps, WorkingHours } from '@/app/sites/types'

import { CustomMapControl } from '@/components/maps/map-control'
import MapHandler from '@/components/maps/map-handler'

import { submitForm, addWorkingHpours, deleteWorkingHours, deleteSite } from './actions'
import Inventory from './inventory'
import Content from './content'
import { useRouter } from 'next/navigation'

const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']


export default function SiteEdit({ site, apiKey }: { site: SiteProps, apiKey: string }) {

  
  const router = useRouter()

  const [selectedPlace, setSelectedPlace] =
    useState<google.maps.places.PlaceResult | null>(null)

  const [ workingHours, setWorkingHours ] = useState<WorkingHours>({ day: '1', openTime: '', closeTime: '' })

  const [ siteLocation, setSiteLocation ] = useState<{ lat: number, lng: number } | null>(null)
  const [ selectedTab, setSelectedTab ] = useState('general')

  const [ formState, formAction ] = useFormState(submitForm, { status: '' })

  let locationLat = siteLocation?.lat.toString() || site.locationLat
  let locationLng = siteLocation?.lng.toString() || site.locationLng

  console.log('Location', locationLat, locationLng)

  function getHoursAndMinutes(date: Date) {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  }

  console.log('form state', formState)

  const generalTab = (
    <div className="py-4">
        {
          formState.errors &&
            <div className="mt-2">
              {
                (formState.errors || []).map((error) => (
                  <div key={error} className="text-red-500 flex justify-center">{ error }</div>
                ))
              }
            </div>
        }
        <form action={formAction}>
          <div>
            {
              site.id && (
                  <input type="hidden" name="id" value={site.id} />
              )
            }
            
            <div className="mt-4 flex w-full gap-x-1">
              <TextField className="flex-1" name="name" label="Site name" value={site.name || ''} />
              <TextField className="flex-1" name="price" label="Advertised price" value={(site.price || '').toString()} />
            </div>
            
            <input type="hidden" name="locationLat" value={locationLat} />
            <input type="hidden" name="locationLng" value={locationLng} />
          </div>
          <div className="mt-4">
            <Divider>Working hours</Divider>
            <div className="flex flex-wrap gap-x-2 gap-y-2 mt-2">
            {
              
              (site.workingHours || []).sort((a, b) => a.day - b.day).map((hours, index) => (
                <Chip
                  label={`${weekDays[hours.day - 1]}: ${getHoursAndMinutes(hours.openTime)} - ${getHoursAndMinutes(hours.closeTime)}`}
                  variant="outlined"
                  onDelete={(e) => {
                    e.preventDefault()
                    deleteWorkingHours(hours.id)
                  }}
                />
              ))
            }
            </div>
            <div className="flex gap-x-2 mt-4">
                <Select
                  id="weekDaySelect"
                  defaultValue="1"
                  onChange={(e) => setWorkingHours({ ...workingHours, day: e.target.value })}
                  className="w-40 h-[41px]">
                  <MenuItem value="1">Monday</MenuItem>
                  <MenuItem value="2">Tuesday</MenuItem>
                  <MenuItem value="3">Wednesday</MenuItem>
                  <MenuItem value="4">Thursday</MenuItem>
                  <MenuItem value="5">Friday</MenuItem>
                  <MenuItem value="6">Saturday</MenuItem>
                  <MenuItem value="7">Sunday</MenuItem>
                </Select>
                <TextField sx={{ input: { height: '8px' } }} placeholder="09:00" value={workingHours?.openTime} onChange={
                  (e) => setWorkingHours({ ...workingHours, openTime: e.target.value })
                }/>
                <TextField sx={{ input: { height: '8px' } }} placeholder="17:00" value={workingHours?.closeTime} onChange={
                  (e) => setWorkingHours({ ...workingHours, closeTime: e.target.value })
                }/>
                <Button className="flex-1 max-w-[300px]" variant="outlined" onClick={(e) => {
                  e.preventDefault()
                  console.log('Add working hours', workingHours)
                  addWorkingHpours(site.id!, workingHours)
                }}>+ Add</Button>
            </div>
          </div>
          <div className="mt-4 mb-2">
            Site location
          </div>
          <div className="h-[500px]">
            <APIProvider apiKey={apiKey}>
              <Map mapId={'7bd5d546975a15b5'}
                defaultZoom={9}
                defaultCenter={(locationLat && locationLng) ? {
                  lat: Number(locationLat),
                  lng: Number(locationLng)
                } : { lat: 35.5138298, lng: 24.0180367 }}
                gestureHandling={'greedy'}
                disableDefaultUI={true}
                onClick={(e) => {
                  console.log('Map click', e)
                  setSiteLocation(e.detail.latLng)
                }}
              >
                {
                  (locationLat && locationLng) &&
                    <AdvancedMarker position={{ lat: Number(locationLat), lng: Number(locationLng) }} />
                }
              </Map>
              <CustomMapControl
                controlPosition={ControlPosition.TOP_LEFT}
                onPlaceSelect={setSelectedPlace}
              />

              <MapHandler place={selectedPlace} />
            </APIProvider>
          </div>
          <div className="mt-4 pb-6">
            <div className="mb-2">
              <Button fullWidth={true} variant="contained">Save</Button>
            </div>
            <div>
              <Button color="error" variant="outlined" fullWidth={true}
                onClick={async () => {
                  const result = await deleteSite(site.id!)
                  console.log('Delete result', result)
                  router.push('/sites')
                }}>DELETE</Button>
            </div>
          </div>
        </form>
      </div>
  )

  const tabs: { [key: string]: ReactElement } = {
    'general': generalTab,
    'content': <Content siteId={site.id || ''} content={{ image: site.image, description: site.description }}/>,
    'inventory': <Inventory apiKey={apiKey} siteLat={locationLat || '35.5138298'} siteLng={locationLng || '24.0180367'} siteId={site.id || ''} inventory={site.inventoryItems || []}/>
  }

  return (
    <div className="container mx-auto mt-2">
      <Tabs variant="fullWidth" value={selectedTab} onChange={(e, value) => {
        setSelectedTab(value)
      }} aria-label="Reservation mode">
        <Tab value="general" label="General" />
        <Tab value="content" label="Content" />
        <Tab value="inventory" label="Inventory" />
      </Tabs>
      {
        tabs[selectedTab]
      }
    </div>
  )

}