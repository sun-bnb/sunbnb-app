export interface SiteProps {
  id?: string | undefined
  name?: string | undefined
  locationLat?: string | undefined
  locationLng?: string | undefined
  inventoryItems?: InventoryItem[]
  workingHours?: WorkingHours[]
  image?: string | null
  imageWidth?: number | null
  imageHeight?: number | null
  description?: string | null
  distance?: number | null
  price?: number | null
  itemCount?: number
  availableCount?: number
  services: string[]
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
  items?: { id: string, number: number }[] | null
  status: string
  type: string
  from: Date
  to: Date
  paymentRef?: string | null
  paymentAmount?: number | null
}

export interface InventoryItem {
  id: string
  number: number
  status: string
  category?: string | null
  pair?: { id: string } | null
  pairedBy?: { id: string } | null
  price?: number | null
  rotation?: number | null
  locationLat?: string
  locationLng?: string
  reservations: Reservation[]
  site?: { id: string } | null
}

export interface WorkingHours {
  id?: string
  day: number
  openTime: Date
  closeTime: Date
}