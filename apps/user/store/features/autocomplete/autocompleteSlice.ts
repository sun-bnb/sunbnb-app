import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

const googlePlacesApiKey = 'YOUR_GOOGLE_API_KEY'; // Replace with your Google API key

export const googlePlacesApi = createApi({
  reducerPath: 'googlePlacesApi',
  baseQuery: fetchBaseQuery({
    baseUrl: '/api/places',
  }),
  endpoints: (builder) => ({
    getAutocompleteSuggestions: builder.query({
      query: (input) => ({
        url: 'autocomplete',
        params: {
          input
        },
      }),
      transformResponse: (response: { data: { predictions: any[] } }) => response.data.predictions,
    }),
    getPlaceDetails: builder.query({
      query: (placeId) => ({
        url: 'details',
        params: {
          placeId,
          key: googlePlacesApiKey
        },
      }),
      transformResponse: (response: { data: { result: { geometry: { location: any } } } }) => response.data.result.geometry.location,
    }),
  }),
});

export const { useGetAutocompleteSuggestionsQuery, useGetPlaceDetailsQuery } = googlePlacesApi;
