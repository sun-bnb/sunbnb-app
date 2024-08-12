'use client'


import { useFormState, useFormStatus } from 'react-dom'
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { APIProvider, ControlPosition, Map, AdvancedMarker } from '@vis.gl/react-google-maps'

import { TextField } from '@repo/ui/TextField'
import { submitForm } from './actions'
import { SiteProps } from '@/app/sites/types'


import ControlPanel from '@/components/maps/control-panel'
import { CustomMapControl } from '@/components/maps/map-control'
import MapHandler from '@/components/maps/map-handler'


export default function SiteEdit({ site, apiKey }: { site: SiteProps, apiKey: string }) {

  const [formState, formAction] = useFormState(submitForm, { status: '' })

  const [selectedPlace, setSelectedPlace] =
    useState<google.maps.places.PlaceResult | null>(null);

  const [ siteLocation, setSiteLocation ] = useState<{ lat: number, lng: number } | null>(null)

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

  let locationLat = siteLocation?.lat || site.locationLat
  let locationLng = siteLocation?.lng || site.locationLng

  console.log('Location', locationLat, locationLng)

  return (
    <div className="container mx-auto px-4">
      <div>Edit Site</div>
      <div>
        <form action={formAction}>
          <div>
            {
              site.id && (
                <div>
                  <div>Site ID: {site.id}</div>
                  <input type="hidden" name="id" value={site.id} />
                </div>
              )
            }
            
            <TextField name="name" label="Site name" value={site.name || ''} />
            <div>Site location {<pre>{locationLat} / {locationLng}</pre>}</div>
            <input type="hidden" name="locationLat" value={locationLat} />
            <input type="hidden" name="locationLng" value={locationLng} />
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
                controlPosition={ControlPosition.TOP}
                onPlaceSelect={setSelectedPlace}
              />

              <ControlPanel />

              <MapHandler place={selectedPlace} />
            </APIProvider>
          </div>
          <div>
            <SubmitButton />
          </div>
        </form>
      </div>
      
    </div>
  )

}