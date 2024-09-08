import { SiteProps, Reservation } from '@/types/shared'
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'

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
    getReservations: builder.query({
      query: ({ siteId, date }) => ({
        url: `reservations/${siteId}`,
        params: { date }
      }),
      transformResponse: (response: { reservations: any[] }) => response
    }),
    getMonthReservations: builder.query({
      query: ({ siteId, month }) => ({
        url: `reservations/${siteId}`,
        params: { month }
      }),
      transformResponse: (response: { reservations: any[] }) => response
    })
  }),
});

export const {
  useGetSiteByIdQuery,
  useLazyGetSiteByIdQuery,
  useGetReservationsQuery,
  useGetMonthReservationsQuery
} = httpApi;
