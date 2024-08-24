"use client";

import { createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'

export interface SearchState {
  searchText: string
  selectedPlace?: { 
    placeId: string
    placeName: string 
  } | null
}

const initialState: SearchState = {
  searchText: ''
}

export const searchSlice = createSlice({
  name: 'search',
  initialState,
  reducers: {
    setSearchState: (state, action: PayloadAction<{ searchText: string }>) => {
      state.searchText = action.payload.searchText
    },
    setSelectedPlace: (state, action: PayloadAction<{ selectedPlace: { placeId: string, placeName: string } | null }>) => {
      state.selectedPlace = action.payload.selectedPlace
    },
    resetSearchState: (state) => {
      state.searchText = ''
    }
  }
})

// Action creators are generated for each case reducer function
export const { setSearchState, setSelectedPlace, resetSearchState } = searchSlice.actions
export default searchSlice.reducer