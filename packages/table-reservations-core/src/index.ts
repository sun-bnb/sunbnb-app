// Public API of @repo/table-reservations-core.
//
// This package owns all restaurant-product business logic: availability math,
// booking creation, status machine, email templates, server-action primitives,
// ownership helpers. No UI. No Sunbnb coupling.
//
// Apps import from this package; they never reimplement.

export * from './types'
export * from './status'
export * from './ownership'

export * from './restaurant/queries'
export * from './restaurant/actions'
export * from './restaurant/slug'

export * from './hours/actions'

export * from './tables/queries'
export * from './tables/actions'

export * from './layout/actions'

export * from './menu/queries'
export * from './menu/actions'

export * from './availability'
export * from './reservations/queries'
export * from './reservations/actions'
export * from './emails'
