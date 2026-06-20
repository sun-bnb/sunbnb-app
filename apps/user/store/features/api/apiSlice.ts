import { Reservation, SiteProps } from '@/app/sites/types';
import { Order } from '@/app/types/types';
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import { SiteGeography } from '@/app/sites/types';

/**
 * Get the anonymous user ID from localStorage (client-side only).
 * Used to pass ownership proof to API routes for unauthenticated users.
 */
function getAnonId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('sunbnb-anonId')
}

/**
 * Build a single-entity GET query that forwards the anonymous owner's `anonId`
 * as proof of ownership when present (omitted entirely for logged-in users).
 *
 * All anon-owned entity lookups (reservation, order, rental booking) MUST go
 * through this so none can silently drop the param — a rental-booking poll that
 * omitted anonId left anonymous users stuck on "Processing payment" (401 loop).
 * Exported for unit testing.
 */
export function anonGetQuery(path: string, id: string, anonId: string | null) {
  return {
    url: `${path}/${id}`,
    params: anonId ? { anonId } : undefined,
  }
}

export const httpApi = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: '/api',
  }),
  endpoints: (builder) => ({
    getSiteById: builder.query({
      query: ({ id }) => ({
        url: `sites/${id}`
      }),
      transformResponse: (response: SiteProps) => response
    }),
    getSitesByCoords: builder.query({
      query: ({ lat, lng }) => ({
        url: 'sites',
        params: {
          lat, lng
        }
      }),
      transformResponse: (response: { sites: SiteProps[], geography?: SiteGeography }) => response
    }),
    getAvailabilityBySiteAndTimeRange: builder.query({
      query: ({ siteId, from, to }) => ({
        url: `sites/${siteId}/availability`,
        params: {
          from, to
        }
      }),
      transformResponse: (response: { availability: { itemId: string, available: boolean }[] }) => response
    }),
    getReservationById: builder.query({
      query: ({ id }) => anonGetQuery('reservations', id, getAnonId()),
      transformResponse: (response: Reservation) => response
    }),
    getOrderById: builder.query({
      query: ({ id }) => anonGetQuery('orders', id, getAnonId()),
      transformResponse: (response: Order) => response
    }),
    getRentalBookingById: builder.query({
      query: ({ id }) => anonGetQuery('rental-bookings', id, getAnonId()),
      transformResponse: (response: any) => response
    }),
    getRentalAvailability: builder.query({
      query: ({ siteId, from, to }: { siteId: string; from: string; to: string }) => ({
        url: `sites/${siteId}/rental-availability`,
        params: { from, to },
      }),
      transformResponse: (response: {
        availability: { rentalItemId: string; totalQuantity: number; inUse: number; availableQuantity: number }[]
      }) => response
    }),
  }),
});

export const { 
  useGetSitesByCoordsQuery,
  useGetAvailabilityBySiteAndTimeRangeQuery,
  useGetReservationByIdQuery,
  useGetOrderByIdQuery,
  useGetRentalBookingByIdQuery,
  useGetSiteByIdQuery,
  useLazyGetSiteByIdQuery,
  useGetRentalAvailabilityQuery,
} = httpApi;
