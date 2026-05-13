'use client'

import { useState } from 'react'
import Button from '@mui/material/Button'
import RestaurantIcon from '@mui/icons-material/Restaurant'

export interface EnableRestaurantCtaLabels {
  title: string
  description: string
  button: string
  enabling: string
  errorPrefix: string
}

export interface EnableRestaurantCtaProps {
  labels: EnableRestaurantCtaLabels
  onEnable: () => Promise<{ status: 'ok' | 'error'; errors?: string[] }>
}

/**
 * Empty-state card shown when a Site has no linked Restaurant. Clicking the
 * CTA invokes the app's `enableTableReservations` wrapper. Styling matches the
 * outlined-card language of the partner app (blue-tinted active card, rounded,
 * 2px border).
 */
export function EnableRestaurantCta({ labels, onEnable }: EnableRestaurantCtaProps) {
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  return (
    <div className="rounded-lg border-2 border-gray-200 bg-white p-5 max-w-xl">
      <div className="flex items-center gap-2 mb-2">
        <RestaurantIcon fontSize="small" className="text-gray-500" />
        <span className="font-medium text-sm text-gray-900">{labels.title}</span>
      </div>
      <p className="text-xs text-gray-500 mb-4">{labels.description}</p>
      <Button
        variant="contained"
        size="small"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setErrors([])
          const res = await onEnable()
          setBusy(false)
          if (res.status === 'error') setErrors(res.errors ?? [])
        }}
        sx={{ textTransform: 'none' }}
      >
        {busy ? labels.enabling : labels.button}
      </Button>
      {errors.length > 0 && (
        <p className="mt-2 text-xs text-red-600">
          {labels.errorPrefix}: {errors.join(', ')}
        </p>
      )}
    </div>
  )
}
