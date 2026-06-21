export interface ServiceFee {
  id: string
  chargeType: string
  feeAmount?: number | null
  percentage?: number | null
  serviceCode: string
  accountId?: string | null
  siteId?: string | null
}

export interface LayoutElementProps {
  id: string
  // Exactly one of siteId or restaurantId is set (DB-level CHECK constraint).
  siteId?: string | null
  restaurantId?: string | null
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
  cornerRadius?: number | null
}

export interface SiteProps {
  id?: string | undefined
  name?: string | undefined
  userId?: string | undefined
  locationLat?: string | undefined
  locationLng?: string | undefined
  layoutMode?: string
  layoutWidth?: number | null
  layoutHeight?: number | null
  restaurantId?: string | null
  layoutElements?: LayoutElementProps[]
  inventoryItems?: InventoryItem[]
  products?: Product[]
  rentalItems?: RentalItemProps[]
  rentalBookings?: RentalBookingProps[]
  vat?: number | null
  rentalVat?: number | null
  rentalPaymentType?: string | null
  workingHours?: { id: string, day: number, openTime: Date, closeTime: Date }[]
  image?: string | null
  imageWidth?: number | null
  imageHeight?: number | null
  type?: string | null
  orderPaymentType?: string | null
  description?: string | null
  background?: string | null
  bgImageUrl?: string | null
  bgImageWidth?: number | null
  bgImageHeight?: number | null
  price?: number | null
  status?: string | null
  services: string[]
  serviceFees?: ServiceFee[]
  subscriptionTier?: 'STARTER' | 'PRO' | 'BUSINESS' | null
  appSalesEnabled?: boolean
  paymentProvider?: string
  noShowDeadlineMinutes?: number | null
  features?: string[]
  mollieOnboardingStatus?: string | null
  hasMollieToken?: boolean
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
  category?: string | null
  soldOut?: boolean
  prepTime?: number | null
}

/** Per-day operational state row (ReservationDay model). */
export interface ReservationDayRow {
  id: string
  reservationId: string
  date: Date
  operationalStatus: string
  checkedInAt: Date | null
  departedAt: Date | null
}

export interface Reservation {
  id: string
  siteId: string
  itemId?: string | null
  type: string
  status: string
  operationalStatus: string
  from: Date
  to: Date
  checkedInAt?: Date | null
  departedAt?: Date | null
  guestName?: string | null
  guestContact?: string | null
  internalNotes?: string | null
  paymentAmount?: number | null
  paymentRef?: string | null
  refundedAt?: Date | null
  isComp?: boolean
  user: {
    id: string
    email: string
  }
  items?: InventoryItem[] | null
  /** Today's per-day operational state row. Absent for blocked reservations. */
  today?: ReservationDayRow | null
  /**
   * Whether the booking's stay is over (no remaining reserved days — `to` is on
   * or before the end of today). Computed server-side so client/server timezones
   * can't skew the comparison. A departed/no-show booking only frees its bed when
   * this is true (single-day or last day); mid-stay it stays held. (track 012)
   */
  stayOver?: boolean
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
  schematicX?: number | null
  schematicY?: number | null
  pairId?: string | null
  pair?: InventoryItem | null
  pairedBy?: InventoryItem | null
  sunbedGroupId?: string | null
  sunbedGroup?: { id: string; items: { id: string; number?: number; status?: string }[] } | null
  seatLabel?: string | null
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

  notes?: string | null
  rejectReason?: string | null
  acceptedAt?: Date | null
  readyAt?: Date | null
  deliveredAt?: Date | null

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
  notes?: string | null
  category?: string | null

}

export interface RentalItemProps {
  id: string
  siteId: string
  name: string
  description?: string | null
  imageUrl?: string | null
  category?: string | null
  pricePerHour?: number | null
  pricePerDay?: number | null
  totalQuantity: number
  active: boolean
}

export interface RentalBookingProps {
  id: string
  siteId: string
  rentalItemId: string
  userId: string
  from: Date
  to: Date
  quantity: number
  durationType: string
  totalPrice: number
  status: string
  operationalStatus: string
  guestName?: string | null
  paymentRef?: string | null
  pickedUpAt?: Date | null
  returnedAt?: Date | null
  rentalItem: RentalItemProps
  user: { id: string; name?: string | null; email: string }
}