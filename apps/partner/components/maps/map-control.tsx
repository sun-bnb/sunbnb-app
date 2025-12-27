import React from 'react'
import { ControlPosition, MapControl } from '@vis.gl/react-google-maps'

import { PlaceAutocompleteClassic } from './autocomplete-classic'

type CustomAutocompleteControlProps = {
  controlPosition: ControlPosition
  onPlaceSelect: (place: google.maps.places.PlaceResult | null) => void
};

export const CustomMapControl = ({
  controlPosition,
  onPlaceSelect
}: CustomAutocompleteControlProps) => {
  const SafeMapControl = MapControl as unknown as React.ComponentType<any>
  return (
    <SafeMapControl position={controlPosition}>
      <div className="autocomplete-control px-2 py-2">
        <PlaceAutocompleteClassic onPlaceSelect={onPlaceSelect} />
      </div>
    </SafeMapControl>
  )

}
