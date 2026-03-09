import { useMap } from '@vis.gl/react-google-maps'
import React, { useEffect } from 'react'

interface Props {
  place: google.maps.places.PlaceResult | null;
}

const MapHandler = ({place}: Props) => {
  const map = useMap()

  useEffect(() => {
    if (!map || !place) return;

    if (place.geometry?.viewport) {
      map.fitBounds(place.geometry.viewport)
    } else if (place.geometry?.location) {
      map.panTo(place.geometry.location)
      map.setZoom(15)
    }
  }, [map, place])

  return null
}

export default React.memo(MapHandler)
