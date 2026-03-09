import React, { useRef, useEffect } from 'react'
import { useMapsLibrary } from '@vis.gl/react-google-maps'

interface Props {
  onPlaceSelect: (place: google.maps.places.PlaceResult | null) => void
}

// Migrated to PlaceAutocompleteElement (new API replacing deprecated Autocomplete widget)
// https://developers.google.com/maps/documentation/javascript/place-autocomplete-element
export const PlaceAutocompleteClassic = ({onPlaceSelect}: Props) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const places = useMapsLibrary('places')

  useEffect(() => {
    if (!places || !containerRef.current) return

    // Clear any previous element
    containerRef.current.innerHTML = ''

    const autocomplete = new places.PlaceAutocompleteElement({
      componentRestrictions: undefined,
    })

    // Style the element to match the previous input
    autocomplete.style.width = '100%'

    autocomplete.addEventListener('gmp-placeselect', async (event: any) => {
      const place = event.place
      if (place) {
        // Fetch full details (geometry, name, formatted_address) to match old API shape
        await place.fetchFields({ fields: ['location', 'displayName', 'formattedAddress'] })
        // Convert to PlaceResult-like shape for compatibility
        onPlaceSelect({
          geometry: {
            location: place.location,
          },
          name: place.displayName,
          formatted_address: place.formattedAddress,
        } as google.maps.places.PlaceResult)
      }
    })

    containerRef.current.appendChild(autocomplete as unknown as Node)
  }, [places, onPlaceSelect])

  return (
    <div className="autocomplete-container" ref={containerRef} />
  )
}
