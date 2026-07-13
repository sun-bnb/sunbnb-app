'use client'

import { useTranslations } from 'next-intl'

export type ManageViewKey = number | 'rentals'

interface ManageToolbarProps {
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

  // The pill row only carries parcels now (rentals is a floating FAB) — show it
  // only when there's more than one parcel to switch between.
  const showSwitcher = parcelNums.length > 1

  // Parcel tabs form ONE continuous bar docked to the bottom of the header card,
  // hanging out from beneath it. Adjoined (no gaps): every tab shares a right-edge
  // divider (border-r), only the first/last carry the outer left/right ends and
  // bottom rounding, and there's no top border (their tops tuck behind the card).
  // The wrapper's negative margin + the card's z-index give the "from under" look.
  const tabClass = (active: boolean, isFirst: boolean, isLast: boolean) =>
    `flex-shrink-0 flex items-center justify-center gap-1 px-3 pt-5 pb-3 min-h-[52px] border-b border-r border-t-0 text-sm font-semibold whitespace-nowrap transition-colors select-none ${
      isFirst ? 'border-l rounded-bl-lg ' : ''
    }${isLast ? 'rounded-br-lg ' : ''}${
      active
        ? 'bg-accent text-white border-accent dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
        : 'bg-white text-gray-500 border-gray-200 hover:text-gray-900 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-400 dark:border-gray-700 dark:hover:text-gray-100 dark:hover:bg-gray-800'
    }`

  return (
    <>
      {/* Header card — zoom control (sticky) */}
      <div
        className={`flex items-center justify-between gap-3 px-3 py-2 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm sticky top-0 z-10${showSwitcher ? '' : ' mb-5'}`}
      >
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

        {/* View controls — reverse seat order + dark mode */}
        <div className="flex items-center gap-2 flex-shrink-0">
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

      {/* View switcher — parcel tabs DOCKED to the bottom of the header card,
          hanging out from underneath it. The outer wrapper pulls the row up so the
          tab tops tuck behind the card (which sits above via its sticky z-10); the
          inner row scrolls horizontally when the tabs outgrow the container. */}
      {showSwitcher && (
        <div className="relative z-0 -mt-2 mb-5">
          <div
            role="tablist"
            aria-label={t('parcel', { n: '' }).trim()}
            className="flex flex-nowrap items-stretch px-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {parcelNums.map((n, i) => (
              <button
                key={n}
                role="tab"
                aria-selected={selectedView === n}
                onClick={() => onSelectView(n)}
                className={tabClass(
                  selectedView === n,
                  i === 0,
                  i === parcelNums.length - 1,
                )}
              >
                {t('parcel', { n })}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
