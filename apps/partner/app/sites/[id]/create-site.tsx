'use client'

import { useFormState, useFormStatus } from 'react-dom'
import React, { useEffect, useState } from 'react'
import { APIProvider, ControlPosition, Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import { SiteProps } from '@/types/shared'

import { CustomMapControl } from '@/components/maps/map-control'
import MapHandler from '@/components/maps/map-handler'

import { submitForm } from './site-actions'
import { useRouter } from 'next/navigation'


export default function CreateSite({ site, apiKey }: { site: SiteProps, apiKey: string }) {

  const router = useRouter()

  const [selectedPlace, setSelectedPlace] =
    useState<google.maps.places.PlaceResult | null>(null)

  const [ siteLocation, setSiteLocation ] = useState<{ lat: number, lng: number } | null>(null)

  const [ formState, formAction ] = useFormState(submitForm, { status: '' })

  let locationLat = siteLocation?.lat.toString() || site.locationLat
  let locationLng = siteLocation?.lng.toString() || site.locationLng

  useEffect(() => {
    if (formState.status === 'ok' && formState.siteId) {
      router.push(`/sites/${formState.siteId}/general`)
    }
  }, [formState])

  const SafeAPIProvider = APIProvider as unknown as React.ComponentType<any>
  const SafeMap = Map as unknown as React.ComponentType<any>
  const SafeAdvancedMarker = AdvancedMarker as unknown as React.ComponentType<any>

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
            <SafeAPIProvider apiKey={apiKey}>
              <SafeMap mapId={'7bd5d546975a15b5'}
                defaultZoom={9}
                defaultCenter={(locationLat && locationLng) ? {
                  lat: Number(locationLat),
                  lng: Number(locationLng)
                } : { lat: 35.5138298, lng: 24.0180367 }}
                gestureHandling={'greedy'}
                disableDefaultUI={true}
                onClick={(e: any) => {
                  setSiteLocation(e.detail.latLng)
                }}
              >
                {
                  (locationLat && locationLng) &&
                    <SafeAdvancedMarker position={{ lat: Number(locationLat), lng: Number(locationLng) }} />
                }
              </SafeMap>
              <CustomMapControl
                controlPosition={ControlPosition.TOP_LEFT}
                onPlaceSelect={setSelectedPlace}
              />

              <MapHandler place={selectedPlace} />
            </SafeAPIProvider>
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
