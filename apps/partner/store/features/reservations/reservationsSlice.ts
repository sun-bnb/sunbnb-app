'use client'

import { createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'

export interface ReservationsState {
  [key: string]: any
}

const initialState: ReservationsState = {
  view: 'day'
}

export const reservationsSlice = createSlice({
  name: 'reservations',
  initialState,
  reducers: {
    setValue: (state, action: PayloadAction<{ [key: string]: any }>) => {
      Object.keys(action.payload).forEach(key => {
        state[key] = action.payload[key]
      })
    }
  }
});

export const { setValue } = reservationsSlice.actions
export default reservationsSlice.reducer