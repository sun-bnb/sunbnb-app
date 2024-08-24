import { SiteProps } from '@/app/sites/types';
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'

export const httpApi = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: '/api',
  }),
  endpoints: (builder) => ({
    getSitesByCoords: builder.query({
      query: ({ lat, lng }) => ({
        url: 'sites',
        params: {
          lat, lng
        },
      }),
      transformResponse: (response: { sites: SiteProps[], bounds: any }) => response,
    })
  }),
});

export const { useGetSitesByCoordsQuery } = httpApi;
