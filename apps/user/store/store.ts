import { Dispatch, Middleware, UnknownAction, configureStore } from '@reduxjs/toolkit'
import CounterSlice from './features/counter/CounterSlice'
import searchSlice from './features/search/searchSlice'
import { googlePlacesApi } from './features/autocomplete/autocompleteSlice'
import { httpApi } from './features/api/apiSlice'

export const unauthenticatedMiddleware: Middleware = ({
  dispatch
 }) => (next) => (action) => {
  return next(action);
 }
 
export const makeStore = () => {
  return configureStore({
    reducer: {
      counter: CounterSlice,
      search: searchSlice,
      [googlePlacesApi.reducerPath]: googlePlacesApi.reducer,
      [httpApi.reducerPath]: httpApi.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(googlePlacesApi.middleware, httpApi.middleware),
  })
}

// Infer the type of makeStore
export type AppStore = ReturnType<typeof makeStore>
// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<AppStore['getState']>
export type AppDispatch = AppStore['dispatch']