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
  type?: string | null
  description?: string | null
  distance?: number | null
  price?: number | null
  itemCount?: number
  availableCount?: number
  appSalesEnabled?: boolean | undefined
  services: string[]
  paymentProvider?: string
  features?: string[]
  /** Site.partialGroupBookingEnabled — guests may book part of a sunbed unit, not just the whole unit. */
  partialGroupBookingEnabled?: boolean
  rentalPaymentType?: string | null
  rentalItems?: RentalItemProps[]
  layoutMode?: string | null
  layoutWidth?: number | null
  layoutHeight?: number | null
  layoutElements?: LayoutElementProps[]
  restaurantId?: string | null
}

export interface LayoutElementProps {
  id: string
  siteId?: string
  type: string
  shape: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  z: number
  label?: string | null
  color?: string | null
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
  anonId?: string | null
  site?: { id: string, name?: string | null, type?: string | null }
  itemId?: string | null
  items?: { id: string, number: number, seatLabel?: string | null }[] | null
  orders?: { 
    id: string,
    createdAt: Date,
    status: string,
    totalPrice: number,
    orderItems: { 
      id: string
      name: string
      quantity: number
      price: number
      tax: number
      totalPrice: number
    }[],
    invoices?: Invoice[]
  }[] | null
  status: string
  operationalStatus?: string
  type: string
  from: Date
  to: Date
  paymentRef?: string | null
  paymentAmount?: number | null
  guestName?: string | null
}

export interface Invoice {
  id: string
  issuerType?: string
  totalCharge: number
  totalTax: number
  totalAmount: number
  invoiceLines: {
    id: string
    description: string | null
    charge: number
    vatRate: number | null
    tax: number
    amount: number
  }[]
}

export interface InventoryItem {
  id: string
  number: number
  seatLabel?: string | null
  group: number
  status: string
  category?: string | null
  sunbedGroupId?: string | null
  sunbedGroup?: { items: { id: string }[] } | null
  price?: number | null
  rotation?: number | null
  locationLat?: string
  locationLng?: string
  schematicX?: number | null
  schematicY?: number | null
  /**
   * Optional: surfaces that decide availability SERVER-side (the POS seat page)
   * never fetch reservation rows. Consumers must guard — and must not re-derive
   * availability from them; that is `service/availabilityService`'s job.
   */
  reservations?: Reservation[]
  site?: { id: string } | null
}

export interface WorkingHours {
  id?: string
  day: number
  openTime: Date
  closeTime: Date
}

export interface RentalItemProps {
  id: string
  name: string
  description: string | null
  category: string | null
  pricePerHour: number | null
  pricePerDay: number | null
  totalQuantity: number
  availableQuantity?: number
}