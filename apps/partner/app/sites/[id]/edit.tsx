'use client'


import { useFormState, useFormStatus } from 'react-dom'
import React, { ReactElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { APIProvider, ControlPosition, Map, AdvancedMarker } from '@vis.gl/react-google-maps'

import { TextField } from '@repo/ui/TextField'
import { SiteProps } from '@/app/sites/types'

import ControlPanel from '@/components/maps/control-panel'
import { CustomMapControl } from '@/components/maps/map-control'
import MapHandler from '@/components/maps/map-handler'

import { submitForm } from './actions'
import Inventory from './inventory'
import Content from './content'

interface TabItem {
  id: string
  label: string
}

function TabBar({ items, tabSelected } : { items: TabItem[], tabSelected: (id: string) => void }) {

  const [ selectedTab, setSelectedTab ] = useState('general')

  return (
    <div className="">
      <nav className="flex gap-x-1">
        {
          items.map((item, index) => (
            <button key={index} type="button"
              className={'w-40 border border-radius-2 p-2' + (item.id === selectedTab ? ' font-bold bg-gray-100' : '')} onClick={() => {
                setSelectedTab(item.id)
                tabSelected(item.id)
              }}>
                {item.label}
            </button>
          ))
        }
        <div className="ml-auto"></div>
      </nav>
    </div>
  )
}

export default function SiteEdit({ site, apiKey }: { site: SiteProps, apiKey: string }) {

  const [formState, formAction] = useFormState(submitForm, { status: '' })

  const [selectedPlace, setSelectedPlace] =
    useState<google.maps.places.PlaceResult | null>(null);

  const [ siteLocation, setSiteLocation ] = useState<{ lat: number, lng: number } | null>(null)
  const [ selectedTab, setSelectedTab ] = useState('general')

  function SubmitButton() {
    const status = useFormStatus()
    return <button 
      disabled={status.pending}
      type="submit"
      className="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none disabled:bg-blue-100 font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center">
        Save
    </button>
  }

  console.log('API KEY', apiKey, selectedPlace)

  let locationLat = siteLocation?.lat.toString() || site.locationLat
  let locationLng = siteLocation?.lng.toString() || site.locationLng

  console.log('Location', locationLat, locationLng)

  const generalTab = (
    <div>
        <form action={formAction}>
          <div>
            {
              site.id && (
                  <input type="hidden" name="id" value={site.id} />
              )
            }
            
            <div className="mt-4">
              <TextField name="name" label="Site name" value={site.name || ''} />
            </div>
            
            <input type="hidden" name="locationLat" value={locationLat} />
            <input type="hidden" name="locationLng" value={locationLng} />
          </div>
          <div className="mt-4">
            <label className="block mb-2 text-sm font-medium text-gray-900">Site location</label>
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
          <div className="mt-4">
            <SubmitButton />
          </div>
        </form>
      </div>
  )

  console.log('inv items', site.inventoryItems)

  const tabs: { [key: string]: ReactElement } = {
    'general': generalTab,
    'content': <Content siteId={site.id || ''} content={{}}/>,
    'inventory': <Inventory apiKey={apiKey} siteLat={locationLat || '35.5138298'} siteLng={locationLng || '24.0180367'} siteId={site.id || ''} inventory={site.inventoryItems || []}/>
  }

  return (
    <div className="container mx-auto px-4">
      <TabBar items={[
        { id: 'general', label: 'General' },
        { id: 'content', label: 'Content' },
        { id: 'inventory', label: 'Inventory' }
      ]} tabSelected={setSelectedTab}/>
      {
        tabs[selectedTab]
      }
    </div>
  )

}