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
  /**
   * `Site.code` (track 022) — the site half of the printed QR URL
   * (`/q/S-K7M2X9/1-1-1`). Optional: nullable until backfilled.
   */
  code?: string | null
  /** Site.customBrandEnabled / customBrandKey (track 023) — the two gates behind a bespoke page. */
  customBrandEnabled?: boolean | null
  customBrandKey?: string | null
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
  /** Guests may book part of a sunbed unit (a SunbedGroup), not just the whole unit. */
  partialGroupBookingEnabled?: boolean
  mollieOnboardingStatus?: string | null
  hasMollieToken?: boolean
  // Server-computed inventory scalars (track 020 C2). Tabs that only needed a
  // COUNT used to force the whole item array (and every item's reservations,
  // with guest emails) into the payload. Optional so any caller that still
  // ships items keeps working.
  itemCount?: number
  activeItemCount?: number
  availableTodayCount?: number
  /**
   * Parcel-tier summary (track 020 C2 slice 2). Present on the inventory tab
   * INSTEAD of a full `inventoryItems` array: the editor draws overview boxes
   * and every aggregate from these ~12 rows, and streams a parcel's seats in
   * only when it is opened or enters the seat-zoom viewport.
   */
  parcels?: ParcelSummary[]
  ungroupedCount?: number
}

export interface ParcelSummary {
  group: number
  count: number
  itemGroupId: string | null
  rows: number | null
  seatsPerRow: number | null
  horizontalGap: number | null
  verticalGap: number | null
  pairGap: number | null
  rotation: number | null
  locationLat: string | null
  locationLng: string | null
  schematicX: number | null
  schematicY: number | null
  category: string | null
  price: number | null
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

// The floor view-model types (ReservationDayRow, Reservation, InventoryItem)
// moved to @repo/floor-core so the mobile floor app can share them ([[track:024]] P6-lite).
// Re-exported here so existing '@/types/shared' imports keep working.
import type { ReservationDayRow, Reservation, InventoryItem } from '@repo/floor-core/types'
export type { ReservationDayRow, Reservation, InventoryItem }

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
  // Nullable since dine-in v2: standalone-restaurant tab orders have no site.
  siteId: string | null

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

  /** Denormalized dine-in table reference (matches Table.id). No FK relation on Order. */
  tableId?: string | null

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

// Rental view-model types moved to @repo/floor-core ([[track:024]] W6) —
// shared with the mobile floor app. Re-exported for existing imports.
import type { RentalItemProps, RentalBookingProps } from '@repo/floor-core/types'
export type { RentalItemProps, RentalBookingProps }
