'use client'

import { useState, useRef, useEffect } from 'react'
import { useTranslations } from 'next-intl'

/** A selectable roster member for the current-worker FAB. */
export interface WorkerOption {
  id: string
  name: string
}

/** Initials for the FAB face when a worker is set (1 word → first 2 chars). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

/**
 * Current-worker FAB — bottom-left floating control that sets the floor-staff
 * member every on-site action is auto-attributed to (remembered per-device).
 * Mirrors the bottom-right rentals/parcels FAB. Tapping opens an upward popover:
 * the roster (tap to select/switch), "No worker", and — once a worker is set —
 * the Till (open till + close). Rendered only when the account has a roster, so
 * single-operator venues see nothing. No PIN — switching is a tap.
 */
export default function ManageWorkerFab({
  employees,
  currentWorkerId,
  onSelectWorker,
  onOpenTill,
}: {
  employees: WorkerOption[]
  currentWorkerId: string | null
  onSelectWorker: (id: string | null) => void
  onOpenTill: () => void
}) {
  const t = useTranslations('SiteManage')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = employees.find(e => e.id === currentWorkerId) ?? null

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div className="fixed bottom-6 left-6 z-40" ref={ref}>
      {/* Popover — opens upward from the FAB */}
      {open && (
        <div
          role="listbox"
          className="absolute bottom-full left-0 mb-3 w-60 max-h-[60vh] overflow-y-auto bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg py-1"
        >
          {employees.map(e => {
            const selected = e.id === currentWorkerId
            return (
              <button
                key={e.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => { onSelectWorker(e.id); setOpen(false) }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm text-left transition-colors ${
                  selected
                    ? 'font-semibold text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-800'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                <span className="truncate">{e.name}</span>
                {selected && (
                  <svg className="w-4 h-4 flex-shrink-0 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                )}
              </button>
            )
          })}

          {currentWorkerId && (
            <>
              <button
                type="button"
                onClick={() => { onOpenTill(); setOpen(false) }}
                className="w-full border-t border-gray-100 dark:border-gray-800 px-3 py-2.5 text-sm text-left font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center gap-2"
              >
                <span aria-hidden="true">💶</span> {t('till')}
              </button>
              <button
                type="button"
                onClick={() => { onSelectWorker(null); setOpen(false) }}
                className="w-full border-t border-gray-100 dark:border-gray-800 px-3 py-2.5 text-sm text-left text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                {t('noWorker')}
              </button>
            </>
          )}

        </div>
      )}

      {/* The FAB itself — initials when a worker is set, person icon otherwise */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={current ? current.name : t('setWorker')}
        title={current ? current.name : t('setWorker')}
        className={`w-14 h-14 rounded-full shadow-lg flex items-center justify-center select-none active:scale-95 transition ${
          current
            ? 'bg-accent text-white hover:bg-accent-hover dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white'
            : 'bg-white text-gray-500 border border-gray-200 hover:text-gray-900 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700'
        }`}
      >
        {current ? (
          <span className="text-base font-bold tracking-tight">{initials(current.name)}</span>
        ) : (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
          </svg>
        )}
      </button>
    </div>
  )
}
