export interface SiteProps {
  id?: string | undefined
  name?: string | undefined
  locationLat?: string | undefined
  locationLng?: string | undefined
  inventoryItems?: { id: string, number: number, status: string }[]
  workingHours?: { id: string, day: number, openTime: Date, closeTime: Date }[]
  image?: string | null
  description?: string | null
  distance?: number
  price?: number | null
  itemCount?: number
  availableCount?: number
}

export interface InventoryItem {
  id: string
  number: number
  status: string
  locationLat?: string
  locationLng?: string
}

export interface WorkingHours {
  id?: string
  day: string
  openTime: string
  closeTime: string
}