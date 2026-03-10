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
      query: ({ id }) => {
        const anonId = getAnonId()
        return {
          url: `reservations/${id}`,
          params: anonId ? { anonId } : undefined,
        }
      },
      transformResponse: (response: Reservation) => response
    }),
    getOrderById: builder.query({
      query: ({ id }) => {
        const anonId = getAnonId()
        return {
          url: `orders/${id}`,
          params: anonId ? { anonId } : undefined,
        }
      },
      transformResponse: (response: Order) => response
    }),
    getRentalBookingById: builder.query({
      query: ({ id }) => ({
        url: `rental-bookings/${id}`,
      }),
      transformResponse: (response: any) => response
    })
  }),
});

export const { 
  useGetSitesByCoordsQuery,
  useGetAvailabilityBySiteAndTimeRangeQuery,
  useGetReservationByIdQuery,
  useGetOrderByIdQuery,
  useGetRentalBookingByIdQuery,
  useGetSiteByIdQuery,
  useLazyGetSiteByIdQuery
} = httpApi;
