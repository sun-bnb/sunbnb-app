'use client'

import { useFormState, useFormStatus } from 'react-dom'
import React, { useEffect, useState } from 'react'
import { APIProvider, ControlPosition, Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import { SiteProps } from '@/app/sites/types'

import { CustomMapControl } from '@/components/maps/map-control'
import MapHandler from '@/components/maps/map-handler'

import { submitForm } from './actions'
import { useRouter } from 'next/navigation'


export default function CreateSite({ site, apiKey }: { site: SiteProps, apiKey: string }) {

  const router = useRouter()

  const [selectedPlace, setSelectedPlace] =
    useState<google.maps.places.PlaceResult | null>(null)

  const [ siteLocation, setSiteLocation ] = useState<{ lat: number, lng: number } | null>(null)

  const [ formState, formAction ] = useFormState(submitForm, { status: '' })

  function SubmitButton() {
    const status = useFormStatus()
    return <button 
      disabled={status.pending}
      type="submit"
      className="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none disabled:bg-blue-100 font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center">
        Save
    </button>
  }

  let locationLat = siteLocation?.lat.toString() || site.locationLat
  let locationLng = siteLocation?.lng.toString() || site.locationLng

  console.log('Location', locationLat, locationLng)
  console.log('form state', formState)

  useEffect(() => {
    if (formState.status === 'ok' && formState.siteId) {
      router.push(`/sites/${formState.siteId}`)
    }
  }, [formState])

  const generalTab = (
    <div>
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
            <div className="mt-4 flex w-full gap-x-1">
              <TextField fullWidth={true} name="name" label="Site name" defaultValue={site.name || ''} />
            </div>
            <input type="hidden" name="locationLat" value={locationLat} />
            <input type="hidden" name="locationLng" value={locationLng} />
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
          <div className="mt-4">
            <Button type="submit" variant="contained" fullWidth={true}>Save</Button>
          </div>
        </form>
      </div>
  )

  return (
    <div className="container mx-auto px-4 mt-2">
      { generalTab }
    </div>
  )

}