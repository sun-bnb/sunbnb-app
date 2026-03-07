'use client'

import { useState } from 'react'
import { updatePaymentProvider } from './actions'

interface SiteRow {
  id: string
  name: string
  status: string
  paymentProvider: string
  ownerName: string
  hasMollie: boolean
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
        setError(result.error ?? 'Failed')
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
