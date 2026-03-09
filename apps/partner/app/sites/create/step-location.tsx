'use client'

import React, { useState } from 'react'
import { APIProvider, ControlPosition, Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import PlaceIcon from '@mui/icons-material/Place'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { CustomMapControl } from '@/components/maps/map-control'
import MapHandler from '@/components/maps/map-handler'
import { WizardData } from './create-site-wizard'

export default function StepLocation({
  data,
  update,
  apiKey,
}: {
  data: WizardData
  update: (p: Partial<WizardData>) => void
  apiKey: string
}) {

  const [selectedPlace, setSelectedPlace] =
    useState<google.maps.places.PlaceResult | null>(null)

  const SafeAPIProvider = APIProvider as unknown as React.ComponentType<any>
  const SafeMap = Map as unknown as React.ComponentType<any>
  const SafeAdvancedMarker = AdvancedMarker as unknown as React.ComponentType<any>

  const hasLocation = !!(data.locationLat && data.locationLng)

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-800 mb-1">Set site location</h2>
      <p className="text-sm text-gray-500 mb-4">
        Use the search bar or click directly on the map to place a marker where your beach is.
        You can drag the map to explore and click to adjust the position.
      </p>

      {/* Status indicator */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded mb-3 text-sm ${
        hasLocation
          ? 'bg-green-50 border border-green-200 text-green-700'
          : 'bg-amber-50 border border-amber-200 text-amber-700'
      }`}>
        {hasLocation ? (
          <>
            <CheckCircleIcon fontSize="small" />
            <span>Location set — {Number(data.locationLat).toFixed(5)}, {Number(data.locationLng).toFixed(5)}</span>
          </>
        ) : (
          <>
            <PlaceIcon fontSize="small" />
            <span>No location selected yet — click the map to place a marker</span>
          </>
        )}
      </div>

      <div className={`h-[450px] rounded overflow-hidden transition-all ${
        hasLocation
          ? 'border-2 border-green-300'
          : 'border-2 border-dashed border-amber-300'
      }`}>
        <SafeAPIProvider apiKey={apiKey}>
          <SafeMap
            mapId="wizard-map"
            defaultZoom={9}
            defaultCenter={
              hasLocation
                ? { lat: Number(data.locationLat), lng: Number(data.locationLng) }
                : { lat: 35.5138298, lng: 24.0180367 }
            }
            gestureHandling="greedy"
            disableDefaultUI
            onClick={(e: any) => {
              const latLng = e.detail.latLng
              if (latLng) {
                update({
                  locationLat: latLng.lat.toString(),
                  locationLng: latLng.lng.toString(),
                })
              }
            }}
          >
            {hasLocation && (
              <SafeAdvancedMarker
                position={{
                  lat: Number(data.locationLat),
                  lng: Number(data.locationLng),
                }}
              />
            )}
            <CustomMapControl
              controlPosition={ControlPosition.TOP_LEFT}
              onPlaceSelect={setSelectedPlace}
            />
            <MapHandler place={selectedPlace} />
          </SafeMap>
        </SafeAPIProvider>
      </div>
    </div>
  )
}
