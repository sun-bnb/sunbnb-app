'use client'

import SyncIcon from '@mui/icons-material/Sync'
import CloudDoneIcon from '@mui/icons-material/CloudDone'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface SaveStatusBannerLabels {
  saving: string
  saved: string
  idle: string
  error: string
}

export interface SaveStatusBannerProps {
  status: SaveStatus
  labels: SaveStatusBannerLabels
  /** Optional extra detail appended after the error message. */
  errorDetails?: string
}

/**
 * Top-of-page save status indicator — the same pattern the Sunbnb general
 * tab, restaurant settings tab, and schematic editor use. Render as the
 * first row of the editor page so every consumer feels consistent.
 */
export function SaveStatusBanner({ status, labels, errorDetails }: SaveStatusBannerProps) {
  const cls =
    status === 'saving'
      ? 'bg-blue-50 border border-blue-200 text-blue-600'
      : status === 'saved'
        ? 'bg-green-50 border border-green-200 text-green-600'
        : status === 'error'
          ? 'bg-red-50 border border-red-200 text-red-600'
          : 'bg-gray-50 border border-gray-200 text-gray-400'

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-center gap-2 px-3 py-2 rounded mb-4 text-sm transition-all ${cls}`}
    >
      {status === 'saving' && (
        <>
          <SyncIcon fontSize="small" className="animate-spin" /> {labels.saving}
        </>
      )}
      {status === 'saved' && (
        <>
          <CloudDoneIcon fontSize="small" /> {labels.saved}
        </>
      )}
      {status === 'error' && (
        <>
          <WarningAmberIcon fontSize="small" /> {labels.error}
          {errorDetails && <span className="ml-1">— {errorDetails}</span>}
        </>
      )}
      {status === 'idle' && (
        <>
          <CloudDoneIcon fontSize="small" /> {labels.idle}
        </>
      )}
    </div>
  )
}
