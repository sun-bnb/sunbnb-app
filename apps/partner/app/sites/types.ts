export interface SiteProps {
  id?: string | undefined
  name?: string | undefined
  locationLat?: string | undefined
  locationLng?: string | undefined
  inventoryItems?: { id: string, number: number, status: string }[]
  workingHours?: { id: string, day: number, openTime: Date, closeTime: Date }[]
  image?: string | null
  imageWidth?: number | null
  imageHeight?: number | null
  description?: string | null
  price?: number | null
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