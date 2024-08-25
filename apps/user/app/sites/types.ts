export interface SiteProps {
  id?: string | undefined
  name?: string | undefined
  locationLat?: string | undefined
  locationLng?: string | undefined
  inventoryItems?: InventoryItem[]
  workingHours?: { id: string, day: number, openTime: Date, closeTime: Date }[]
  image?: string | null
  description?: string | null
  distance?: number | null
  price?: number | null
  itemCount?: number
  availableCount?: number
}

export interface MapCenter {
  lat: number
  lng: number
}

export interface MapBounds {
  north: number
  south: number
  east: number
  west: number
}

export interface SiteGeography {
  center: MapCenter
  bounds: MapBounds
}

export interface Reservation {
  id: string
  userId: string
  itemId?: string | null
  status: string
  type: string
  from: Date
  to: Date
}

export interface InventoryItem {
  id: string
  number: number
  status: string
  locationLat?: string
  locationLng?: string
  reservations: Reservation[]
}

export interface WorkingHours {
  id?: string
  day: string
  openTime: string
  closeTime: string
}