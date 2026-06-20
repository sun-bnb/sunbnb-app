/**
 * Unit tests for the shared `anonGetQuery` builder behind the anon-owned entity
 * lookups (reservation, order, rental booking).
 *
 * Regression guard: a rental-booking poll that omitted `anonId` returned 401 on
 * every request, leaving anonymous renters stuck on "Processing payment". All
 * three endpoints now route through this one builder, so the param can't be
 * dropped for one entity again.
 */

import { describe, it, expect } from 'vitest'
import { anonGetQuery } from './apiSlice'

const ANON = '550e8400-e29b-41d4-a716-446655440000'

describe('anonGetQuery', () => {
  it('forwards anonId as a query param when present (anonymous owner)', () => {
    expect(anonGetQuery('rental-bookings', 'rb-1', ANON)).toEqual({
      url: 'rental-bookings/rb-1',
      params: { anonId: ANON },
    })
  })

  it('omits params entirely when there is no anonId (logged-in user)', () => {
    expect(anonGetQuery('rental-bookings', 'rb-1', null)).toEqual({
      url: 'rental-bookings/rb-1',
      params: undefined,
    })
  })

  it('builds the path from the entity segment and id', () => {
    expect(anonGetQuery('reservations', 'res-9', ANON).url).toBe('reservations/res-9')
    expect(anonGetQuery('orders', 'ord-9', ANON).url).toBe('orders/ord-9')
    expect(anonGetQuery('rental-bookings', 'rb-9', ANON).url).toBe('rental-bookings/rb-9')
  })
})
