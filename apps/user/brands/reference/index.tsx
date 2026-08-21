'use client'

import BookingSurface from '@/components/booking/BookingSurface'
import type { BrandPageProps } from '../types'

/**
 * The reference brand module (track 023 P3).
 *
 * Deliberately plain. It exists to prove the mechanism end to end — registry
 * resolution, code splitting, the admin switch, the fall-back path — while the
 * page itself is disposable, so any surprise in the wiring is cheap to find. A
 * real customer shell is a design exercise; this is not one, and it should not
 * grow into one.
 *
 * It is also the worked example of the contract: own the layout, own the copy,
 * and mount `BookingSurface` rather than rebuilding the drawer. The banner is
 * here on purpose — if this page ever appears in front of a customer, that is a
 * misconfiguration and it should say so out loud rather than look plausible.
 */
export default function ReferenceBrandPage({ site, apiKey, initialAvailableCount }: BrandPageProps) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-amber-950">
        Reference brand module — wiring demo, not a customer design
      </div>

      <div className="mx-auto max-w-6xl px-4 py-10 lg:flex lg:gap-8">
        <div className="lg:flex-[3] lg:min-w-0">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Custom brand page</p>
          <h1 className="mt-2 text-4xl font-semibold">{site.name}</h1>
          {site.description && (
            <p className="mt-4 max-w-prose leading-relaxed text-slate-300">{site.description}</p>
          )}

          <dl className="mt-8 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <div className="rounded-lg border border-slate-800 p-3">
              <dt className="text-slate-400">Site code</dt>
              <dd className="mt-1 font-mono">{site.code ?? '—'}</dd>
            </div>
            <div className="rounded-lg border border-slate-800 p-3">
              <dt className="text-slate-400">Free today</dt>
              <dd className="mt-1">{initialAvailableCount ?? '—'}</dd>
            </div>
            <div className="rounded-lg border border-slate-800 p-3">
              <dt className="text-slate-400">Brand key</dt>
              <dd className="mt-1 font-mono">{site.customBrandKey ?? '—'}</dd>
            </div>
          </dl>

          <p className="mt-8 max-w-prose text-sm text-slate-400">
            Everything above is this module&apos;s own layout. The booking panel beside it is the
            platform&apos;s <code className="font-mono text-slate-300">BookingSurface</code> — the same
            component the standard page mounts, so changes to the funnel reach this page without
            anyone editing it.
          </p>
        </div>

        <BookingSurface site={site} apiKey={apiKey} theme={{ background: '#0f172a', foreground: '#e2e8f0' }} />
      </div>
    </div>
  )
}
