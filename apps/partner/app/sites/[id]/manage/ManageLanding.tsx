'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'

interface ManageLandingProps {
  siteId: string
  siteName: string
  accessKey: string
  isAdmin: boolean
}

/**
 * Landing page for the token-gated manage surface.
 * Renders the site name and navigation buttons to each sub-route.
 *
 * "Sunbed management" is always visible.
 * "Daily summary" is shown only when isAdmin (the token carries 'admin' in resources).
 */
export default function ManageLanding({
  siteId,
  siteName,
  accessKey,
  isAdmin,
}: ManageLandingProps) {
  const t = useTranslations('ManageLanding')

  const sunbedsHref = `/sites/${siteId}/manage/sunbeds?key=${accessKey}`
  const summaryHref = `/sites/${siteId}/manage/summary?key=${accessKey}`
  const closeHref = `/sites/${siteId}/manage/close?key=${accessKey}`
  const trendsHref = `/sites/${siteId}/manage/trends?key=${accessKey}`

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Site name */}
        <h1 className="text-2xl font-black text-gray-900 text-center mb-1">{siteName}</h1>
        <p className="text-sm text-gray-500 text-center mb-8">{t('title')}</p>

        <div className="flex flex-col gap-3">
          {/* Sunbed management — always shown */}
          <Link
            href={sunbedsHref}
            className="w-full flex items-center gap-4 bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4 hover:border-gray-300 hover:shadow transition-all group"
          >
            <span className="text-2xl" aria-hidden="true">⛱️</span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-gray-900 group-hover:text-gray-700">{t('sunbedManagement')}</div>
            </div>
            <svg
              className="w-5 h-5 text-gray-400 group-hover:text-gray-600 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          {/* Daily summary — admin-only */}
          {isAdmin && (
            <Link
              href={summaryHref}
              className="w-full flex items-center gap-4 bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4 hover:border-gray-300 hover:shadow transition-all group"
            >
              <span className="text-2xl" aria-hidden="true">📊</span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-900 group-hover:text-gray-700">{t('dailySummary')}</div>
              </div>
              <svg
                className="w-5 h-5 text-gray-400 group-hover:text-gray-600 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}

          {/* Day close — admin-only */}
          {isAdmin && (
            <Link
              href={closeHref}
              className="w-full flex items-center gap-4 bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4 hover:border-gray-300 hover:shadow transition-all group"
            >
              <span className="text-2xl" aria-hidden="true">🏁</span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-900 group-hover:text-gray-700">{t('dayClose')}</div>
              </div>
              <svg
                className="w-5 h-5 text-gray-400 group-hover:text-gray-600 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}

          {/* Trends — admin-only */}
          {isAdmin && (
            <Link
              href={trendsHref}
              className="w-full flex items-center gap-4 bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4 hover:border-gray-300 hover:shadow transition-all group"
            >
              <span className="text-2xl" aria-hidden="true">📈</span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-900 group-hover:text-gray-700">{t('trends')}</div>
              </div>
              <svg
                className="w-5 h-5 text-gray-400 group-hover:text-gray-600 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
