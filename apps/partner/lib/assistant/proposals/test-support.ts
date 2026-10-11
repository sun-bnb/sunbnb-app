/** Shared fixtures for the assistant proposal tests (not a test file; no vi.mock here). */
export const OWNER = 'owner-1'
export const SITE = 'site-1'
export const CONV = 'conv-1'

export const siteRow = (over: Record<string, unknown> = {}) => ({
  name: 'Playa Azul',
  type: 'paid',
  price: 9,
  vat: 21,
  locationLat: '36.5',
  locationLng: '-4.9',
  description: 'A beach',
  services: ['wc'],
  status: 'active',
  partialGroupBookingEnabled: false,
  features: ['rentals'],
  slug: 'playa-azul',
  customBrandEnabled: false,
  customBrandKey: null,
  userId: OWNER,
  ...over,
})
