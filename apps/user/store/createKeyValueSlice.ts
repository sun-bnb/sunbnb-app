'use client'

import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export type KeyValueState = Record<string, any>

/**
 * Factory for creating a generic key-value Redux slice.
 * Each slice manages a flat Record<string, any> and exposes a single
 * `setValue` action that merges the payload keys into state.
 */
export function createKeyValueSlice(name: string) {
  const slice = createSlice({
    name,
    initialState: {} as KeyValueState,
    reducers: {
      setValue: (state, action: PayloadAction<Record<string, any>>) => {
        for (const key of Object.keys(action.payload)) {
          state[key] = action.payload[key]
        }
      },
    },
  })

  return slice
}
