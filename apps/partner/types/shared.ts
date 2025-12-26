export interface SiteProps {
  id?: string | undefined
  name?: string | undefined
  userId?: string | undefined
  locationLat?: string | undefined
  locationLng?: string | undefined
  inventoryItems?: InventoryItem[]
  products?: Product[]
  vat?: number | null
  workingHours?: { id: string, day: number, openTime: Date, closeTime: Date }[]
  image?: string | null
  imageWidth?: number | null
  imageHeight?: number | null
  type?: string | null
  description?: string | null
  background?: string | null
  bgImageUrl?: string | null
  bgImageWidth?: number | null
  bgImageHeight?: number | null
  price?: number | null
  status?: string | null
  services: string[]
}

export interface Product {
  id: string
  name: string
  description?: string | null
  imageUrl?: string | null
  imageWidth?: number | null
  imageHeight?: number | null
  price: number
  tax: number
  totalPrice: number
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
    id: string
    email: string
  }
  items?: InventoryItem[] | null
}

export interface InventoryItem {
  id: string
  number: number
  group: number
  itemGroupId?: string | null
  status: string
  category?: string | null
  price?: number | null
  rotation?: number | null
  label?: string | null
  locationLat?: string
  locationLng?: string
  pairId?: string | null
  pair?: InventoryItem | null
  pairedBy?: InventoryItem | null
  reservations?: Reservation[]
}

export interface WorkingHours {
  id?: string
  day: string
  openTime: string
  closeTime: string
}

export interface Order {

  id: string

  invoiceId?: string | null
  seat?: InventoryItem | null

  userId?: string | null
  anonId?: string | null
  siteId: string
  
  status : string     

  price: number
  tax: number
  totalPrice: number

  paymentRef?: string | null
  paymentAmount?: number | null

  orderItems: OrderItem[]

  createdAt: Date

}

interface OrderItem {

  id: string

  orderId: string
  productId: string

  quantity: number
  name: string
  price: number
  tax: number
  totalPrice: number

}