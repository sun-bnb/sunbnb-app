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

export interface AvailabilitySlot {
  from: Date
  to: Date
  availableTableIds: string[]
}

export interface ActionResult {
  status: 'ok' | 'error'
  errors?: string[]
}
