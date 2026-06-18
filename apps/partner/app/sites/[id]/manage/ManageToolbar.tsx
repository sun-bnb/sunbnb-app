'use client'

import { useTranslations } from 'next-intl'

type BedState = 'available' | 'expected' | 'checked-in' | 'walked-in' | 'blocked' | 'comp'

export type ManageViewKey = number | 'rentals'

interface ManageToolbarProps {
  summary: Partial<Record<BedState, number>>
  occupied: number
  // View switcher
  parcelNums: number[]
  selectedView: ManageViewKey
  onSelectView: (view: ManageViewKey) => void
  // Zoom
  zoom: number
  zoomMin: number
  zoomMax: number
  onZoomIn: () => void
  onZoomOut: () => void
  onResetZoom: () => void
  // Reverse seat order — acts on the active parcel
  isReversed: boolean
  onToggleReversed: () => void
  // Dark mode toggle
  isDark: boolean
  onToggleDark: () => void
}

export default function ManageToolbar({
  summary,
  occupied,
  parcelNums,
  selectedView,
  onSelectView,
  zoom,
  zoomMin,
  zoomMax,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  isReversed,
  onToggleReversed,
  isDark,
  onToggleDark,
}: ManageToolbarProps) {
  const t = useTranslations('SiteManage')

  const reserved = summary['expected'] ?? 0
  const comp = summary['comp'] ?? 0
  const free = summary['available'] ?? 0
  // The pill row only carries parcels now (rentals is a floating FAB) — show it
  // only when there's more than one parcel to switch between.
  const showSwitcher = parcelNums.length > 1

  const tabClass = (active: boolean) =>
    `flex-shrink-0 flex items-center justify-center gap-1 px-3 min-h-[44px] rounded-lg text-sm font-semibold whitespace-nowrap transition-colors select-none ${
      active
        ? 'bg-accent text-white dark:bg-gray-100 dark:text-gray-900'
        : 'bg-white text-gray-500 border border-gray-200 hover:text-gray-900 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-400 dark:border-gray-700 dark:hover:text-gray-100 dark:hover:bg-gray-800'
    }`

  return (
    <>
      {/* Header card — compact occupancy readout + zoom control (sticky) */}
      <div className="flex items-center justify-between gap-3 mb-2 px-3 py-2 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm sticky top-0 z-10">
        {/* Occupied / Reserved / Comp / free — color-coded, no slashes, no word labels */}
        <span className="flex items-center gap-2.5 text-base font-bold tabular-nums whitespace-nowrap leading-none">
          <span className="text-blue-600 dark:text-blue-400" title={t('checkedIn')}>O{occupied}</span>
          <span className="text-yellow-600 dark:text-yellow-400" title={t('expected')}>R{reserved}</span>
          {comp > 0 && <span className="text-purple-600 dark:text-purple-400" title={t('comp')}>C{comp}</span>}
          <span className="text-green-600 dark:text-green-400" title={t('free')}>{free}</span>
        </span>

        {/* Right controls — zoom + reverse seat order + dark mode toggle */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Zoom control — always visible (scroll+zoom is the only mode) */}
          <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 font-semibold">
          <button
            onClick={onZoomOut}
            disabled={zoom <= zoomMin}
            aria-label={t('zoomOut')}
            title={t('zoomOut')}
            className="flex items-center justify-center px-3 min-h-[36px] text-sm transition-colors bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed"
          >
            −
          </button>
          <button
            onClick={onResetZoom}
            aria-label={t('resetZoom')}
            title={t('resetZoom')}
            className="flex items-center justify-center px-2 min-h-[36px] text-xs font-semibold border-l border-gray-200 dark:border-gray-700 transition-colors bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 tabular-nums min-w-[3.5rem]"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={onZoomIn}
            disabled={zoom >= zoomMax}
            aria-label={t('zoomIn')}
            title={t('zoomIn')}
            className="flex items-center justify-center px-3 min-h-[36px] text-sm border-l border-gray-200 dark:border-gray-700 transition-colors bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed"
          >
            +
          </button>
          </div>

          {/* Reverse seat order — applies to the active parcel */}
          <button
            onClick={onToggleReversed}
            aria-label={t('reverseOrder')}
            aria-pressed={isReversed}
            title={t('reverseOrder')}
            className={`flex items-center justify-center px-3 min-h-[36px] rounded-lg border text-base font-semibold transition-colors ${
              isReversed
                ? 'bg-accent text-white border-accent'
                : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            <span aria-hidden="true">⇄</span>
          </button>

          {/* Dark mode toggle */}
          <button
            type="button"
            onClick={onToggleDark}
            aria-label={t('toggleTheme')}
            aria-pressed={isDark}
            title={t('toggleTheme')}
            className="flex items-center justify-center px-3 min-h-[36px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors font-semibold"
          >
            <span aria-hidden="true">{isDark ? '☀' : '☾'}</span>
          </button>
        </div>
      </div>

      {/* View switcher — a bare pill row OUTSIDE the header card; always a single
          row, scrolling horizontally if it outgrows the container. */}
      {showSwitcher && (
        <div
          role="tablist"
          aria-label={t('parcel', { n: '' }).trim()}
          className="flex flex-nowrap items-center gap-1.5 mb-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {parcelNums.map(n => (
            <button
              key={n}
              role="tab"
              aria-selected={selectedView === n}
              onClick={() => onSelectView(n)}
              className={tabClass(selectedView === n)}
            >
              {t('parcel', { n })}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
