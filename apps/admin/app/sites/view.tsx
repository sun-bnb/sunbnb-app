'use client'

import { useState } from 'react'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import CircularProgress from '@mui/material/CircularProgress'
import { updateBillingModel, updatePlatformVatConfig } from './actions'

type BillingModel = 'INTERMEDIARY' | 'DEEMED_PROVIDER'

interface SiteRow {
  id: string
  name: string
  status: string
  billingModel: BillingModel
  platformVatConfigId: string | null
  ownerName: string
}

interface VatConfig {
  id: string
  companyName: string
  countryCode: string
}

export default function SitesView({
  sites,
  vatConfigs,
}: {
  sites: SiteRow[]
  vatConfigs: VatConfig[]
}) {
  const [updating, setUpdating] = useState<string | null>(null)
  const [localSites, setLocalSites] = useState(sites)
  const [error, setError] = useState<string | null>(null)

  const handleBillingModelChange = async (siteId: string, value: BillingModel) => {
    setUpdating(siteId)
    setError(null)
    const result = await updateBillingModel(siteId, value)
    setUpdating(null)
    if (result.status === 'ok') {
      setLocalSites((prev) =>
        prev.map((s) => (s.id === siteId ? { ...s, billingModel: value } : s))
      )
    } else {
      setError(result.errors?.[0] ?? 'Failed to update')
    }
  }

  const handleVatConfigChange = async (siteId: string, value: string) => {
    const configId = value || null
    setUpdating(siteId)
    setError(null)
    const result = await updatePlatformVatConfig(siteId, configId)
    setUpdating(null)
    if (result.status === 'ok') {
      setLocalSites((prev) =>
        prev.map((s) => (s.id === siteId ? { ...s, platformVatConfigId: configId } : s))
      )
    } else {
      setError(result.errors?.[0] ?? 'Failed to update')
    }
  }

  return (
    <div className="p-4">
      <div className="mt-4 mb-6">
        <h2 className="text-lg font-semibold text-gray-800">Sites</h2>
        <p className="text-sm text-gray-500 mt-1">
          Manage site-level platform settings. Changes take effect on new
          transactions.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 mb-4">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {localSites.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
          <p className="text-sm">No sites found</p>
        </div>
      )}

      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <th className="text-left px-4 py-2.5 font-medium">Site</th>
              <th className="text-left px-4 py-2.5 font-medium">Partner</th>
              <th className="text-left px-4 py-2.5 font-medium">Status</th>
              <th className="text-left px-4 py-2.5 font-medium">Billing Model</th>
              <th className="text-left px-4 py-2.5 font-medium">Platform Entity</th>
            </tr>
          </thead>
          <tbody>
            {localSites.map((site) => (
              <tr key={site.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-800">{site.name}</div>
                </td>
                <td className="px-4 py-3 text-gray-500">{site.ownerName}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    site.status === 'active'
                      ? 'bg-green-50 text-green-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}>
                    {site.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Select
                      value={site.billingModel}
                      onChange={(e) => handleBillingModelChange(site.id, e.target.value as BillingModel)}
                      size="small"
                      disabled={updating === site.id}
                      sx={{ fontSize: '0.8rem', height: 32, minWidth: 160 }}
                    >
                      <MenuItem value="DEEMED_PROVIDER" sx={{ fontSize: '0.8rem' }}>
                        Deemed Provider
                      </MenuItem>
                      <MenuItem value="INTERMEDIARY" sx={{ fontSize: '0.8rem' }}>
                        Intermediary
                      </MenuItem>
                    </Select>
                    {updating === site.id && <CircularProgress size={16} />}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Select
                    value={site.platformVatConfigId ?? ''}
                    onChange={(e) => handleVatConfigChange(site.id, e.target.value)}
                    size="small"
                    displayEmpty
                    disabled={updating === site.id || site.billingModel !== 'DEEMED_PROVIDER'}
                    sx={{
                      fontSize: '0.8rem',
                      height: 32,
                      minWidth: 180,
                      ...(site.billingModel !== 'DEEMED_PROVIDER' && { opacity: 0.4 }),
                    }}
                  >
                    <MenuItem value="" sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
                      — Auto (fallback) —
                    </MenuItem>
                    {vatConfigs.map((vc) => (
                      <MenuItem key={vc.id} value={vc.id} sx={{ fontSize: '0.8rem' }}>
                        {vc.companyName} ({vc.countryCode})
                      </MenuItem>
                    ))}
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
