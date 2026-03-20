import React from 'react'
import { ControlPosition, MapControl } from '@vis.gl/react-google-maps'

import { PlaceAutocompleteClassic } from './autocomplete-classic'

type CustomAutocompleteControlProps = {
  controlPosition: ControlPosition
  onPlaceSelect: (place: google.maps.places.PlaceResult | null) => void
  onFocusChange?: (focused: boolean) => void
};

export const CustomMapControl = ({
  controlPosition,
  onPlaceSelect,
  onFocusChange,
}: CustomAutocompleteControlProps) => {
  const SafeMapControl = MapControl as unknown as React.ComponentType<any>
  return (
    <SafeMapControl position={controlPosition}>
      <div
        className="autocomplete-control py-2 pl-2.5"
        style={{ width: '330px' }}
        onFocusCapture={() => onFocusChange?.(true)}
        onBlurCapture={() => onFocusChange?.(false)}
      >
        <PlaceAutocompleteClassic onPlaceSelect={onPlaceSelect} />
      </div>
    </SafeMapControl>
  )

}
