import { SiteProps } from '@/app/sites/types'
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
    })
  }),
});

export const {
  useGetSiteByIdQuery,
  useLazyGetSiteByIdQuery
} = httpApi;
