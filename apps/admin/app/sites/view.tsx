'use client'

import { useState } from 'react'
import { setCustomBrand, setCustomBrandKey, updatePaymentProvider } from './actions'
import { BRAND_KEYS, type BrandRenderReason } from '@repo/data/brand-manifest'

interface SiteRow {
  id: string
  name: string
  status: string
  paymentProvider: string
  customBrandEnabled: boolean
  customBrandKey: string | null
  brandReason: BrandRenderReason
  ownerName: string
  hasMollie: boolean
}

/** Human wording for what a guest actually gets, resolved from BOTH gates. */
const REASON_LABEL: Record<BrandRenderReason, { text: string; className: string }> = {
  live: { text: 'live', className: 'bg-green-400/10 text-green-400' },
  disabled: { text: 'off', className: 'bg-gray-800 text-gray-500' },
  'no-key': { text: 'no module', className: 'bg-amber-400/10 text-amber-400' },
  'unknown-key': { text: 'unknown key', className: 'bg-red-400/10 text-red-400' },
}

/**
 * Both halves of the custom-brand gate (track 023): WHICH module renders the
 * site, and whether it is switched on. The badge shows the RESOLVED answer,
 * because "enabled" and "live" are different states and the gap between them —
 * switched on with no module assigned — is the one an operator needs to see.
 */
function CustomBrandControls({ site }: { site: SiteRow }) {
  const [enabled, setEnabled] = useState(site.customBrandEnabled)
  const [brandKey, setBrandKey] = useState(site.customBrandKey ?? '')
  const [reason, setReason] = useState<BrandRenderReason>(site.brandReason)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Mirror of the server's resolver, so the badge updates without a reload. */
  const resolve = (isEnabled: boolean, key: string): BrandRenderReason => {
    if (!key) return isEnabled ? 'no-key' : 'disabled'
    if (!(BRAND_KEYS as readonly string[]).includes(key)) return 'unknown-key'
    return isEnabled ? 'live' : 'disabled'
  }

  const run = async (fn: () => Promise<{ status: string; errors?: string[] }>, apply: () => void) => {
    setSaving(true)
    setError(null)
    try {
      const result = await fn()
      if (result.status === 'ok') apply()
      else setError(result.errors?.[0] ?? 'Failed')
    } catch {
      setError('Failed')
    }
    setSaving(false)
  }

  const badge = REASON_LABEL[reason]

  return (
    <div className="flex items-center gap-2">
      <select
        value={brandKey}
        disabled={saving}
        onChange={(e) => {
          const next = e.target.value
          run(() => setCustomBrandKey(site.id, next || null), () => {
            setBrandKey(next)
            setReason(resolve(enabled, next))
          })
        }}
        className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-gray-500 disabled:opacity-40"
      >
        <option value="">— none —</option>
        {BRAND_KEYS.map((key) => (
          <option key={key} value={key}>{key}</option>
        ))}
        {/* A key assigned before its module was deleted still has to be shown,
            or the select would silently misreport what the row holds. */}
        {brandKey && !(BRAND_KEYS as readonly string[]).includes(brandKey) && (
          <option value={brandKey}>{brandKey} (missing)</option>
        )}
      </select>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={saving}
        onClick={() => {
          const next = !enabled
          run(() => setCustomBrand(site.id, next), () => {
            setEnabled(next)
            setReason(resolve(next, brandKey))
          })
        }}
        className={`px-3 py-1 rounded text-xs font-medium border disabled:opacity-40 disabled:cursor-not-allowed ${
          enabled
            ? 'border-green-700 text-green-300 hover:bg-green-900/30'
            : 'border-gray-700 text-gray-400 hover:bg-gray-800'
        }`}
      >
        {enabled ? 'On' : 'Off'}
      </button>
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${badge.className}`}>
        {badge.text}
      </span>
      {saving && <span className="text-[10px] text-gray-500">saving…</span>}
      {error && <span className="text-[10px] text-red-400" title={error}>⚠</span>}
    </div>
  )
}

function ProviderSelect({ site }: { site: SiteRow }) {
  const [value, setValue] = useState(site.paymentProvider)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleChange = async (newValue: string) => {
    setSaving(true)
    setError(null)
    try {
      const result = await updatePaymentProvider(site.id, newValue)
      if (result.status === 'ok') {
        setValue(newValue)
      } else {
        setError(result.errors?.[0] ?? 'Failed')
      }
    } catch {
      setError('Failed')
    }
    setSaving(false)
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={value}
        disabled={saving}
        onChange={(e) => handleChange(e.target.value)}
        className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-gray-500 disabled:opacity-40"
      >
        <option value="stripe">Stripe</option>
        <option value="mollie" disabled={!site.hasMollie}>
          Mollie{!site.hasMollie ? ' (not connected)' : ''}
        </option>
      </select>
      {saving && <span className="text-[10px] text-gray-500">saving…</span>}
      {error && <span className="text-[10px] text-red-400" title={error}>⚠</span>}
    </div>
  )
}

export default function SitesView({
  sites,
}: {
  sites: SiteRow[]
}) {
  const [localSites] = useState(sites)

  return (
    <div className="p-4">
      <div className="mt-4 mb-6">
        <h2 className="text-lg font-semibold text-gray-100">Sites</h2>
        <p className="text-sm text-gray-500 mt-1">
          Manage site-level platform settings. Changes take effect on new
          transactions.
        </p>
      </div>

      {localSites.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
          <p className="text-sm">No sites found</p>
        </div>
      )}

      <div className="border border-gray-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-900 text-xs text-gray-500 uppercase tracking-wide">
              <th className="text-left px-4 py-2.5 font-medium">Site</th>
              <th className="text-left px-4 py-2.5 font-medium">Partner</th>
              <th className="text-left px-4 py-2.5 font-medium">Status</th>
              <th className="text-left px-4 py-2.5 font-medium">Payment</th>
              <th className="text-left px-4 py-2.5 font-medium">Custom brand</th>
            </tr>
          </thead>
          <tbody>
            {localSites.map((site) => (
              <tr key={site.id} className="border-t border-gray-800 hover:bg-gray-800/50">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-200">{site.name}</div>
                </td>
                <td className="px-4 py-3 text-gray-400">{site.ownerName}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    site.status === 'active'
                      ? 'bg-green-400/10 text-green-400'
                      : 'bg-gray-800 text-gray-500'
                  }`}>
                    {site.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <ProviderSelect site={site} />
                </td>
                <td className="px-4 py-3">
                  <CustomBrandControls site={site} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
