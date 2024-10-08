export interface SiteProps {
  id?: string | undefined
  name?: string | undefined
  locationLat?: string | undefined
  locationLng?: string | undefined
  inventoryItems?: InventoryItem[]
  workingHours?: { id: string, day: number, openTime: Date, closeTime: Date }[]
  image?: string | null
  imageWidth?: number | null
  imageHeight?: number | null
  description?: string | null
  price?: number | null
  services: string[]
}

export interface Reservation {
  id: string
  siteId: string
  itemId?: string | null
  type: string
  status: string
  from: Date
  to: Date
  user: {
    email: string
  }
  item?: InventoryItem | null
}

export interface InventoryItem {
  id: string
  number: number
  status: string
  locationLat?: string
  locationLng?: string
  reservations?: Reservation[]
}

export interface WorkingHours {
  id?: string
  day: string
  openTime: string
  closeTime: string
}