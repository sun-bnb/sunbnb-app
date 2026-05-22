'use client'

import { useEffect, useRef, useState } from 'react'
import type { RestaurantInput } from '@repo/table-reservations-core'
import { Toggle } from './Toggle'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

// Raw utility strings (this shared package can't see the partner app's
// component classes) — kept aligned with .claude/rules/ui.md by hand.
const INPUT =
  'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900'
const LABEL = 'block text-xs font-medium text-gray-700 mb-1.5'
const HELPER = 'mt-1 block text-xs text-gray-500'
const HEADING = 'text-sm font-medium text-gray-700 mb-3'
const CARD = 'rounded-xl border border-gray-200 bg-white p-5 shadow-sm'

const PRICE_OPTIONS: Array<{ value: number | null; label: string }> = [
  { value: null, label: '—' },
  { value: 1, label: '$' },
  { value: 2, label: '$$' },
  { value: 3, label: '$$$' },
  { value: 4, label: '$$$$' },
]

export interface RestaurantSettingsLabels {
  identityHeading: string
  detailsHeading: string
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
 * Editable restaurant-settings form. Grouped into cards (Identity, Details,
 * Policy, Visibility) per the "settings page" pattern in .claude/rules/ui.md;
 * short fields paired into a 2-column grid; price uses a segmented control and
 * visibility a Tailwind Toggle. Brand-neutral: labels come from the parent.
 *
 * Text fields debounce 1.5s before saving; the price control and toggle save
 * immediately. Save status is propagated up via `onSaveStatusChange` so the
 * parent can drive a single page-level indicator.
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
    <div className="space-y-4">
      {/* Identity — name + link */}
      <section className={CARD}>
        <h3 className={HEADING}>{labels.identityHeading}</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={LABEL}>{labels.name}</span>
            <input
              className={INPUT}
              required
              value={values.name}
              onChange={(e) => {
                const v = e.target.value
                setValues((s) => ({ ...s, name: v }))
                scheduleSave({ name: v })
              }}
            />
            <span className={HELPER}>{labels.nameHelper}</span>
          </label>
          <label className="block">
            <span className={LABEL}>{labels.slug}</span>
            <input
              className={INPUT}
              value={values.slug}
              onChange={(e) => {
                const v = e.target.value
                setValues((s) => ({ ...s, slug: v }))
                scheduleSave({ slug: v })
              }}
            />
            <span className={HELPER}>{labels.slugHelper}</span>
          </label>
        </div>
      </section>

      {/* Details — tagline + description + cuisine + price */}
      <section className={CARD}>
        <h3 className={HEADING}>{labels.detailsHeading}</h3>
        <label className="block mb-3">
          <span className={LABEL}>{labels.tagline}</span>
          <input
            className={INPUT}
            value={values.tagline}
            onChange={(e) => {
              const v = e.target.value
              setValues((s) => ({ ...s, tagline: v }))
              scheduleSave({ tagline: v || null })
            }}
          />
        </label>
        <label className="block mb-3">
          <span className={LABEL}>{labels.description}</span>
          <textarea
            className={INPUT}
            rows={3}
            value={values.description}
            onChange={(e) => {
              const v = e.target.value
              setValues((s) => ({ ...s, description: v }))
              scheduleSave({ description: v || null })
            }}
          />
        </label>
        <label className="block mb-3">
          <span className={LABEL}>{labels.cuisineType}</span>
          <input
            className={INPUT}
            value={values.cuisineType}
            onChange={(e) => {
              const v = e.target.value
              setValues((s) => ({ ...s, cuisineType: v }))
              scheduleSave({ cuisineType: v || null })
            }}
          />
        </label>
        <div>
          <span className={LABEL}>{labels.priceRange}</span>
          <div className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5">
            {PRICE_OPTIONS.map((opt) => {
              const active = values.priceRange === opt.value
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setValues((s) => ({ ...s, priceRange: opt.value }))
                    void save({ priceRange: opt.value })
                  }}
                  className={`min-w-[2.5rem] rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    active ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* Policy + Visibility side by side */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <section className={CARD}>
          <h3 className={HEADING}>{labels.policyHeading}</h3>
          <label className="block mb-3">
            <span className={LABEL}>{labels.averageMealDuration}</span>
            <input
              type="number"
              min={15}
              max={600}
              className={INPUT}
              value={values.averageMealDuration}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (!Number.isFinite(n)) return
                setValues((s) => ({ ...s, averageMealDuration: n }))
                scheduleSave({ averageMealDuration: n })
              }}
            />
            <span className={HELPER}>{labels.averageMealDurationHint}</span>
          </label>
          <label className="block">
            <span className={LABEL}>{labels.reservationWindow}</span>
            <input
              type="number"
              min={1}
              max={365}
              className={INPUT}
              value={values.reservationWindow}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (!Number.isFinite(n)) return
                setValues((s) => ({ ...s, reservationWindow: n }))
                scheduleSave({ reservationWindow: n })
              }}
            />
            <span className={HELPER}>{labels.reservationWindowHint}</span>
          </label>
        </section>

        <section className={CARD}>
          <h3 className={HEADING}>{labels.visibilityHeading}</h3>
          <div className="flex items-start justify-between gap-3">
            <span>
              <span className="block text-sm font-medium text-gray-900">
                {labels.publicOnStandaloneApp}
              </span>
              <span className="mt-0.5 block text-xs text-gray-500">
                {labels.publicOnStandaloneAppHint}
              </span>
            </span>
            <Toggle
              checked={values.publicOnStandaloneApp}
              ariaLabel={labels.publicOnStandaloneApp}
              onChange={(v) => {
                setValues((s) => ({ ...s, publicOnStandaloneApp: v }))
                void save({ publicOnStandaloneApp: v })
              }}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
