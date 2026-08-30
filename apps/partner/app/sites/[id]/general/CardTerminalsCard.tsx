'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import {
  listVivaTerminals,
  discoverVivaTerminals,
  registerVivaTerminal,
  removeVivaTerminal,
} from '@/app/sites/[id]/manage/actions'

interface RegisteredTerminal {
  id: string
  terminalId: string
  label: string | null
  lastSeenAt: string | Date | null
}

interface DiscoveredDevice {
  terminalId: string
  statusId: number
  sourceCode?: string
  registered: boolean
  label: string | null
}

/**
 * Site-scoped Viva Cloud Terminal registry (track 024, W8, packet C1). Calls
 * the manage-surface terminal actions directly (session-authed page, no
 * accessKey — `verifySiteOwnership` falls back to the owner session).
 */
export default function CardTerminalsCard({ siteId }: { siteId: string }) {
  const t = useTranslations('CardTerminals')

  const [terminals, setTerminals] = useState<RegisteredTerminal[]>([])
  const [loading, setLoading] = useState(true)
  const [discovering, setDiscovering] = useState(false)
  const [devices, setDevices] = useState<DiscoveredDevice[] | null>(null)
  const [notConnected, setNotConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingTerminalId, setPendingTerminalId] = useState<string | null>(null)
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({})

  const loadTerminals = useCallback(async () => {
    const result = await listVivaTerminals(siteId)
    if (result.status === 'ok' && result.terminals) {
      setTerminals(result.terminals as RegisteredTerminal[])
    }
    setLoading(false)
  }, [siteId])

  useEffect(() => {
    loadTerminals()
  }, [loadTerminals])

  const handleDiscover = async () => {
    setDiscovering(true)
    setError(null)
    setNotConnected(false)
    const result = await discoverVivaTerminals(siteId)
    if (result.status === 'error') {
      if (result.errors?.[0] === 'Viva not connected') {
        setNotConnected(true)
      } else {
        setError(result.errors?.[0] ?? 'Could not discover devices')
      }
      setDevices(null)
    } else {
      setDevices((result.devices as DiscoveredDevice[]) ?? [])
    }
    setDiscovering(false)
  }

  const handleRegister = async (terminalId: string) => {
    setPendingTerminalId(terminalId)
    setError(null)
    const label = labelDrafts[terminalId]?.trim() || undefined
    const result = await registerVivaTerminal(siteId, terminalId, label)
    if (result.status === 'error') {
      setError(result.errors?.[0] ?? 'Could not register terminal')
    } else {
      await loadTerminals()
      setDevices((prev) => prev?.map((d) => (d.terminalId === terminalId ? { ...d, registered: true } : d)) ?? null)
    }
    setPendingTerminalId(null)
  }

  const handleRemove = async (terminalId: string) => {
    if (!confirm(t('removeConfirm'))) return
    setPendingTerminalId(terminalId)
    setError(null)
    const result = await removeVivaTerminal(siteId, terminalId)
    if (result.status === 'error') {
      setError(result.errors?.[0] ?? 'Could not remove terminal')
    } else {
      await loadTerminals()
      setDevices((prev) => prev?.map((d) => (d.terminalId === terminalId ? { ...d, registered: false } : d)) ?? null)
    }
    setPendingTerminalId(null)
  }

  return (
    <div className="mb-5">
      <h3 className="text-sm font-medium text-gray-700 mb-2">{t('title')}</h3>
      <p className="text-xs text-gray-500 mb-3">{t('subtitle')}</p>

      {error && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-700">{error}</div>
      )}
      {notConnected && (
        <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-xs text-amber-800">
          {t('notConnectedNote')}{' '}
          <a href="/account/viva" className="font-medium underline">{t('connectViva')}</a>
        </div>
      )}

      {!loading && terminals.length === 0 && !devices && (
        <p className="text-xs text-gray-400 mb-3">{t('empty')}</p>
      )}

      {terminals.length > 0 && (
        <ul className="space-y-2 mb-3">
          {terminals.map((terminal) => (
            <li
              key={terminal.id}
              className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3"
            >
              <div>
                <div className="text-sm font-medium text-gray-700">{terminal.label || terminal.terminalId}</div>
                <div className="text-xs text-gray-400 font-mono">{terminal.terminalId}</div>
              </div>
              <button
                type="button"
                onClick={() => handleRemove(terminal.terminalId)}
                disabled={pendingTerminalId === terminal.terminalId}
                className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-40"
              >
                {pendingTerminalId === terminal.terminalId ? t('removing') : t('removeButton')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={handleDiscover}
        disabled={discovering}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
      >
        {discovering ? t('discovering') : t('discoverButton')}
      </button>

      {devices && (
        <ul className="mt-3 space-y-2">
          {devices.length === 0 && <p className="text-xs text-gray-400">{t('noDevicesFound')}</p>}
          {devices.map((device) => (
            <li
              key={device.terminalId}
              className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 p-3"
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs font-mono text-gray-700">{device.terminalId}</div>
                {!device.registered && (
                  <input
                    type="text"
                    placeholder={t('labelPlaceholder')}
                    value={labelDrafts[device.terminalId] ?? ''}
                    onChange={(e) => setLabelDrafts((prev) => ({ ...prev, [device.terminalId]: e.target.value }))}
                    className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-xs"
                  />
                )}
              </div>
              {device.registered ? (
                <span className="ml-3 text-xs font-medium text-green-700">{t('alreadyRegistered')}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => handleRegister(device.terminalId)}
                  disabled={pendingTerminalId === device.terminalId}
                  className="ml-3 text-xs font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-lg px-3 py-1.5 disabled:opacity-40"
                >
                  {pendingTerminalId === device.terminalId ? t('registering') : t('registerButton')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
