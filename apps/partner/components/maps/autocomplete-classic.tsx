import React, { useRef, useCallback, useEffect } from 'react'
import { useMapsLibrary } from '@vis.gl/react-google-maps'

interface Props {
  onPlaceSelect: (place: google.maps.places.PlaceResult | null) => void
}

// Inject global styles for the autocomplete web component
const STYLE_ID = 'gmpac-custom-styles'
function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    gmp-place-autocomplete {
      --gmpac-color-surface: #ffffff !important;
      --gmpac-color-outline: #d1d5db !important;
      --gmpac-color-on-surface: #111827 !important;
      --gmpac-color-on-surface-variant: #6b7280 !important;
      --gmpac-color-primary: #3b82f6 !important;
      --gmpac-font-family-base: inherit !important;
      --gmpac-height-input: 36px !important;
      width: 100% !important;
      max-width: none !important;
      background: #ffffff !important;
      border: 1px solid #d1d5db !important;
      border-radius: 8px !important;
      color-scheme: light only !important;
    }
    /* Dropdown suggestions panel (appended to body) */
    .pac-container {
      background: #ffffff !important;
      border: 1px solid #e5e7eb !important;
      border-radius: 8px !important;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1) !important;
      margin-top: 4px !important;
      z-index: 1000 !important;
    }
    .pac-item {
      background: #ffffff !important;
      color: #374151 !important;
      border-top: 1px solid #f3f4f6 !important;
      padding: 8px 12px !important;
      cursor: pointer !important;
    }
    .pac-item:first-child {
      border-top: none !important;
    }
    .pac-item:hover {
      background: #f3f4f6 !important;
    }
    .pac-item-query {
      color: #111827 !important;
      font-size: 14px !important;
    }
    .pac-matched {
      color: #111827 !important;
      font-weight: 600 !important;
    }
    .pac-item span {
      color: #6b7280 !important;
      font-size: 13px !important;
    }
    .pac-icon {
      filter: none !important;
    }
    /* New API dropdown overlay */
    [class*="gmpac"] {
      background: #ffffff !important;
      color: #111827 !important;
      z-index: 1000 !important;
    }
  `
  document.head.appendChild(style)
}

export const PlaceAutocompleteClassic = ({onPlaceSelect}: Props) => {
  const acRef = useRef<google.maps.places.PlaceAutocompleteElement | null>(null)
  const onPlaceSelectRef = useRef(onPlaceSelect)
  onPlaceSelectRef.current = onPlaceSelect

  // Ensure places library is loaded so the web component registers
  const places = useMapsLibrary('places')

  useEffect(() => {
    ensureStyles()
  }, [])

  const setRef = useCallback((el: google.maps.places.PlaceAutocompleteElement | null) => {
    if (acRef.current) return
    if (!el) return
    acRef.current = el

    const handler = async (event: any) => {
      // New API: gmp-select event with placePrediction
      if (event.placePrediction) {
        const place = event.placePrediction.toPlace()
        await place.fetchFields({ fields: ['location', 'displayName', 'formattedAddress', 'viewport'] })
        onPlaceSelectRef.current({
          geometry: {
            location: place.location,
            viewport: place.viewport,
          },
          name: place.displayName,
          formatted_address: place.formattedAddress,
        } as google.maps.places.PlaceResult)
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        return
      }

      // Fallback: event.place (older API)
      if (event.place && typeof event.place.fetchFields === 'function') {
        const place = event.place
        await place.fetchFields({ fields: ['location', 'displayName', 'formattedAddress', 'viewport'] })
        onPlaceSelectRef.current({
          geometry: {
            location: place.location,
            viewport: place.viewport,
          },
          name: place.displayName,
          formatted_address: place.formattedAddress,
        } as google.maps.places.PlaceResult)
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      }
    }

    el.addEventListener('gmp-placeselect', handler as EventListener)
    el.addEventListener('gmp-select', handler as EventListener)
  }, [])

  if (!places) return null

  return (
    <div className="autocomplete-container" style={{ width: '100%' }}>
      {/* @ts-ignore — gmp-place-autocomplete JSX intrinsic from @vis.gl/react-google-maps */}
      <gmp-place-autocomplete
        ref={setRef}
        style={{ width: '100%' } as React.CSSProperties}
      />
    </div>
  )
}
