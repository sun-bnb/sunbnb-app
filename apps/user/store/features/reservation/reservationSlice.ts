'use client'

import { createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'

interface ValueMap { 
  [key: string]: any
}

export interface ValueMapState {
  [key: string]: any
}

const initialState: ValueMapState = {
}

export const valueMapSlice = createSlice({
  name: 'sites',
  initialState,
  reducers: {
    setValue: (state, action: PayloadAction<{ [key: string]: any }>) => {
      Object.keys(action.payload).forEach(key => {
        state[key] = action.payload[key]
      })
    }
  }
})

// Action creators are generated for each case reducer function
export const { setValue } = valueMapSlice.actions
export default valueMapSlice.reducer