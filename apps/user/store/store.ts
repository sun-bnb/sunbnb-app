import { configureStore } from '@reduxjs/toolkit'
import searchSlice from './features/search/searchSlice'
import sitesSlice from './features/sites/sitesSlice'
import reservationSlice from './features/reservation/reservationSlice'
import { googlePlacesApi } from './features/autocomplete/autocompleteSlice'
import { httpApi } from './features/api/apiSlice'

export const makeStore = () => {
  return configureStore({
    reducer: {
      search: searchSlice,
      sites: sitesSlice,
      reservation: reservationSlice,
      [googlePlacesApi.reducerPath]: googlePlacesApi.reducer,
      [httpApi.reducerPath]: httpApi.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        // Dev-only serializableCheck exemptions for state that holds Date
        // objects BY DESIGN (founder-reported console noise, 2026-08-15 —
        // these warnings drowned out real errors during debugging):
        //  - sites.selectedItems: full InventoryItem rows (createdAt/updatedAt
        //    Dates) — RSC hands the site's items to the client as real Dates
        //    and selection stores the rows verbatim (tracks 014/003 flows).
        //  - sites.reservationDay / dateRange / timeRange: picker values kept
        //    as Date instants.
        // Converting these slices to plain-serializable shapes is a real
        // refactor across the selection/booking flow — if undertaken, remove
        // the exemptions with it. The check never runs in production.
        serializableCheck: {
          ignoredPaths: [
            'sites.selectedItems',
            'sites.reservationDay',
            'sites.dateRange',
            'sites.timeRange',
          ],
          ignoredActionPaths: [
            // RTK Query stores the raw fetch Request/Response in action meta —
            // the exemption the Redux docs themselves prescribe.
            'meta.baseQueryMeta.request',
            'meta.baseQueryMeta.response',
            'payload.selectedItems',
            'payload.reservationDay',
            'payload.dateRange',
            'payload.timeRange',
          ],
        },
      }).concat(googlePlacesApi.middleware, httpApi.middleware),
  })
}

// Infer the type of makeStore
export type AppStore = ReturnType<typeof makeStore>
// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<AppStore['getState']>
export type AppDispatch = AppStore['dispatch']