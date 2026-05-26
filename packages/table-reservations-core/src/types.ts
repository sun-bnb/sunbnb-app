// Shared types for the restaurant product. DB rows use Prisma-generated types
// from @repo/data; these types describe input shapes and DTOs for the
// server-action and rendering layers.

export interface RestaurantInput {
  name: string
  slug: string
  tagline?: string | null
  description?: string | null
  cuisineType?: string | null
  priceRange?: number | null
  averageMealDuration?: number
  reservationWindow?: number
  timeZone?: string | null
  noShowPolicy?: string
  depositPerGuest?: number | null
  cancellationDeadlineHours?: number | null
  layoutWidth?: number | null
  layoutHeight?: number | null
  publicOnStandaloneApp?: boolean
}

export interface TableInput {
  number: number
  label?: string | null
  capacity: number
  minPartySize?: number
  maxPartySize?: number | null
  shape?: 'square' | 'round' | 'rect' | 'oval' | 'booth' | 'bar'
  width?: number
  height?: number
  schematicX?: number | null
  schematicY?: number | null
  rotation?: number
  status?: 'active' | 'inactive'
  zone?: string | null
  staffNote?: string | null
  onlineBookable?: boolean
  combinable?: boolean
  features?: string[]
  requiresDeposit?: boolean | null
  depositPerGuest?: number | null
  turnTimeMinutes?: number | null
  locked?: boolean
  seatsTop?: number | null
  seatsRight?: number | null
  seatsBottom?: number | null
  seatsLeft?: number | null
}

export interface MenuItemInput {
  name: string
  description?: string | null
  price: number
  imageUrl?: string | null
  category?: string
  displayOrder?: number
}

export interface RestaurantHoursInput {
  day: number          // 0..6 (Sun..Sat)
  openTime: string     // "HH:mm"
  closeTime: string    // "HH:mm"
}

export interface RestaurantShiftInput {
  name: string
  day: number              // 0..6 (Sun..Sat)
  startTime: string        // "HH:mm"
  endTime: string          // "HH:mm"
  pacingCovers?: number | null
  pacingWindowMinutes?: number
  lastSeatingOffsetMinutes?: number | null
  requiresDeposit?: boolean
  depositMinPartySize?: number | null
}

export interface TableReservationInput {
  restaurantId: string
  tableId?: string | null
  from: Date
  to: Date
  partySize: number
  guestName: string
  guestEmail: string
  guestPhone?: string | null
  specialRequests?: string | null
  userId?: string | null
  anonId?: string | null
}

export interface TableCombinationInput {
  name?: string | null
  capacity: number
  tableIds: string[]
}

export interface WaitlistEntryInput {
  restaurantId: string
  dateISO: string                  // venue civil date "YYYY-MM-DD"
  requestedTime?: string | null    // "HH:mm" preference
  partySize: number
  guestName: string
  guestEmail: string
  guestPhone?: string | null
  userId?: string | null
  anonId?: string | null
}

export interface AvailabilitySlot {
  from: Date
  to: Date
  availableTableIds: string[]
  /** Predefined combinations bookable at this slot (offered when no single
   *  table fits the party). */
  availableCombinationIds?: string[]
}

export interface ActionResult {
  status: 'ok' | 'error'
  errors?: string[]
}
