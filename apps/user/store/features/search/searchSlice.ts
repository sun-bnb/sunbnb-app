"use client";

import { createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'

export interface SearchState {
  searchText: string
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
    resetSearchState: (state) => {
      state.searchText = ''
    }
  }
})

// Action creators are generated for each case reducer function
export const { setSearchState, resetSearchState } = searchSlice.actions
export default searchSlice.reducer