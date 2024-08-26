import { SiteProps } from '@/app/sites/types';
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import { SiteGeography } from '@/app/sites/types';

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
      transformResponse: (response: { sites: SiteProps[], geography: SiteGeography }) => response
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
      query: ({ id }) => ({
        url: `reservations/${id}`
      }),
      transformResponse: (response: { status: string }) => response
    })
  }),
});

export const { 
  useGetSitesByCoordsQuery,
  useGetAvailabilityBySiteAndTimeRangeQuery,
  useGetReservationByIdQuery,
  useGetSiteByIdQuery,
  useLazyGetSiteByIdQuery
} = httpApi;
