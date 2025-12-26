// components/map/geo.ts
export type Pt = { x: number; y: number }
export type LatLng = { lat: number; lng: number }

export function metersPerDeg(lat: number) {
  const rad = Math.PI / 180
  return { kx: 111_320 * Math.cos(lat * rad), ky: 110_540 }
}

export function makeLocalProjector(origin: LatLng) {
  const { kx, ky } = metersPerDeg(origin.lat)
  return {
    // y: positive = south (down); north → negative y (up on SVG)
    llToWorld(lat: number, lng: number): Pt {
      return { x: (lng - origin.lng) * kx, y: (origin.lat - lat) * ky }
    },
    worldToLl(x: number, y: number): LatLng {
      return { lat: origin.lat - y / ky, lng: origin.lng + x / kx }
    },
  }
}
