'use client'

import { useEffect, useRef, useState } from 'react'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Divider from '@mui/material/Divider'
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import type { RestaurantInput } from '@repo/table-reservations-core'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface RestaurantSettingsLabels {
  identityHeading: string
  policyHeading: string
  visibilityHeading: string
  name: string
  nameHelper: string
  slug: string
  slugHelper: string
  tagline: string
  description: string
  cuisineType: string
  priceRange: string
  averageMealDuration: string
  averageMealDurationHint: string
  reservationWindow: string
  reservationWindowHint: string
  publicOnStandaloneApp: string
  publicOnStandaloneAppHint: string
}

export interface RestaurantSettingsValues {
  name: string
  slug: string
  tagline: string
  description: string
  cuisineType: string
  priceRange: number | null
  averageMealDuration: number
  reservationWindow: number
  publicOnStandaloneApp: boolean
}

export interface RestaurantSettingsFormProps {
  initial: RestaurantSettingsValues
  labels: RestaurantSettingsLabels
  onSave: (
    patch: Partial<RestaurantInput>,
  ) => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
  onSaveStatusChange?: (status: SaveStatus, errors?: string[]) => void
}

/**
 * Editable restaurant-settings form matching the partner-app design language
 * (MUI outlined fields, `h3 text-sm font-medium text-gray-700 mb-2` section
 * headings, dividers). Brand-neutral: labels come from the parent.
 *
 * Text fields debounce 1.5s before saving; the Switch saves immediately on
 * toggle. Save status is propagated up via `onSaveStatusChange` so the parent
 * can drive a single page-level indicator.
 */
export function RestaurantSettingsForm({
  initial,
  labels,
  onSave,
  onSaveStatusChange,
}: RestaurantSettingsFormProps) {
  const [values, setValues] = useState<RestaurantSettingsValues>(initial)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => setValues(initial), [initial])

  const report = (status: SaveStatus, errors?: string[]) => {
    onSaveStatusChange?.(status, errors)
    if (status === 'saved') {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => onSaveStatusChange?.('idle'), 3000)
    }
  }

  const save = async (patch: Partial<RestaurantInput>) => {
    report('saving')
    const res = await onSave(patch)
    if (res.status === 'ok') report('saved')
    else report('error', res.errors)
  }

  const scheduleSave = (patch: Partial<RestaurantInput>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void save(patch), 1500)
  }

  return (
    <div>
      {/* Identity — name + slug */}
      <div className="mb-5">
        <h3 className="text-sm font-medium text-gray-700 mb-2">{labels.identityHeading}</h3>
        <TextField
          fullWidth
          required
          label={labels.name}
          value={values.name}
          onChange={(e) => {
            const v = e.target.value
            setValues((s) => ({ ...s, name: v }))
            scheduleSave({ name: v })
          }}
          helperText={labels.nameHelper}
          sx={{ mb: 2 }}
        />
        <TextField
          fullWidth
          label={labels.slug}
          value={values.slug}
          onChange={(e) => {
            const v = e.target.value
            setValues((s) => ({ ...s, slug: v }))
            scheduleSave({ slug: v })
          }}
          helperText={labels.slugHelper}
        />
      </div>

      <Divider sx={{ mb: 3 }} />

      {/* Marketing — tagline + description + cuisine + price */}
      <div className="mb-5">
        <TextField
          fullWidth
          label={labels.tagline}
          value={values.tagline}
          onChange={(e) => {
            const v = e.target.value
            setValues((s) => ({ ...s, tagline: v }))
            scheduleSave({ tagline: v || null })
          }}
          sx={{ mb: 2 }}
        />
        <TextField
          fullWidth
          label={labels.description}
          value={values.description}
          onChange={(e) => {
            const v = e.target.value
            setValues((s) => ({ ...s, description: v }))
            scheduleSave({ description: v || null })
          }}
          multiline
          minRows={3}
          sx={{ mb: 2 }}
        />
        <div className="flex gap-3">
          <TextField
            fullWidth
            label={labels.cuisineType}
            value={values.cuisineType}
            onChange={(e) => {
              const v = e.target.value
              setValues((s) => ({ ...s, cuisineType: v }))
              scheduleSave({ cuisineType: v || null })
            }}
          />
          <TextField
            select
            label={labels.priceRange}
            value={values.priceRange == null ? '' : String(values.priceRange)}
            onChange={(e) => {
              const raw = e.target.value
              const n = raw === '' ? null : Number(raw)
              setValues((s) => ({ ...s, priceRange: n }))
              void save({ priceRange: n })
            }}
            sx={{ width: 180, flexShrink: 0 }}
          >
            <MenuItem value="">—</MenuItem>
            <MenuItem value="1">$</MenuItem>
            <MenuItem value="2">$$</MenuItem>
            <MenuItem value="3">$$$</MenuItem>
            <MenuItem value="4">$$$$</MenuItem>
          </TextField>
        </div>
      </div>

      <Divider sx={{ mb: 3 }} />

      {/* Reservation policy — meal duration + window */}
      <div className="mb-5">
        <h3 className="text-sm font-medium text-gray-700 mb-2">{labels.policyHeading}</h3>
        <div className="flex gap-3">
          <TextField
            fullWidth
            label={labels.averageMealDuration}
            type="number"
            value={values.averageMealDuration}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n)) return
              setValues((s) => ({ ...s, averageMealDuration: n }))
              scheduleSave({ averageMealDuration: n })
            }}
            helperText={labels.averageMealDurationHint}
            inputProps={{ min: 15, max: 600 }}
          />
          <TextField
            fullWidth
            label={labels.reservationWindow}
            type="number"
            value={values.reservationWindow}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n)) return
              setValues((s) => ({ ...s, reservationWindow: n }))
              scheduleSave({ reservationWindow: n })
            }}
            helperText={labels.reservationWindowHint}
            inputProps={{ min: 1, max: 365 }}
          />
        </div>
      </div>

      <Divider sx={{ mb: 3 }} />

      {/* Visibility */}
      <div className="mb-5">
        <h3 className="text-sm font-medium text-gray-700 mb-2">{labels.visibilityHeading}</h3>
        <FormControlLabel
          control={
            <Switch
              checked={values.publicOnStandaloneApp}
              onChange={(e) => {
                const v = e.target.checked
                setValues((s) => ({ ...s, publicOnStandaloneApp: v }))
                void save({ publicOnStandaloneApp: v })
              }}
            />
          }
          label={
            <span>
              <span className="font-medium text-gray-900 text-sm">
                {labels.publicOnStandaloneApp}
              </span>
              <span className="block text-xs text-gray-500">
                {labels.publicOnStandaloneAppHint}
              </span>
            </span>
          }
        />
      </div>
    </div>
  )
}
