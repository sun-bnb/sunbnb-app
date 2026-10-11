'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { TrackEvent } from '@/components/Analytics'
import { connectViva, refreshVivaStatus, disconnectViva } from './actions'

// Plain string column, not a Prisma enum (repo convention) — normalise defensively at render time.
type VerificationStatus = string | null

interface VivaViewProps {
  isConnected: boolean
  verificationStatus: VerificationStatus
  merchantId: string | null
  connectedAt: string | null
  email: string | null
  connected: boolean
}

function StatusBadge({ status }: { status: VerificationStatus }) {
  const t = useTranslations('Viva')
  if (!status) return null

  const config: Record<string, { cls: string; labelKey: string }> = {
    verified: { cls: 'bg-green-50 text-green-700', labelKey: 'statusVerified' },
    pending: { cls: 'bg-amber-50 text-amber-700', labelKey: 'statusPending' },
    rejected: { cls: 'bg-red-50 text-red-700', labelKey: 'statusRejected' },
  }
  const fallback = { cls: 'bg-gray-50 text-gray-600', labelKey: 'statusUnknown' }
  const cfg = config[status] ?? fallback

  return <span className={`badge ${cfg.cls}`}>{t(cfg.labelKey)}</span>
}

export default function VivaView({
  isConnected,
  verificationStatus,
  merchantId,
  connectedAt,
  email,
  connected,
}: VivaViewProps) {
  const t = useTranslations('Viva')
  const locale = useLocale()

  const [connecting, setConnecting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const isVerified = isConnected && verificationStatus === 'verified'

  const handleConnect = async () => {
    setConnecting(true)
    setActionError(null)
    const result = await connectViva()
    if (result.status === 'error') {
      setActionError(result.message)
      setConnecting(false)
      return
    }
    if (result.redirectUrl) {
      window.location.href = result.redirectUrl
      return
    }
    // Idempotent refresh path — no fresh invitation link, just reflect the
    // refreshed status (the page revalidates via the server action).
    setConnecting(false)
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    setActionError(null)
    const result = await refreshVivaStatus()
    if (result.status === 'error') {
      setActionError(result.message)
    }
    setRefreshing(false)
  }

  const handleDisconnect = async () => {
    if (!confirm(t('disconnectConfirm'))) return
    setDisconnecting(true)
    setActionError(null)
    const result = await disconnectViva()
    if (result.status === 'error') {
      setActionError(result.message)
    }
    setDisconnecting(false)
  }

  return (
    <div className="page-container py-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">{t('title')}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t('subtitle')}</p>
      </div>

      {connected && <TrackEvent name="payments_connected" params={{ provider: 'viva' }} onceKey="payments_connected:viva" />}
      {connected && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <p className="text-sm text-green-800">{t('connectedBanner')}</p>
        </div>
      )}

      {actionError && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          <p className="text-sm text-red-800">{actionError}</p>
        </div>
      )}

      {/* lg+: connection card and the how-it-works aside sit side by side. */}
      <div className="lg:grid lg:grid-cols-3 lg:items-start lg:gap-6">
      <div className="card mb-4 lg:mb-0 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 className="text-sm font-semibold text-gray-900">{t('connectionStatus')}</h2>
          {isConnected ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              {t('connected')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400">
              <span className="w-2 h-2 rounded-full bg-gray-300" />
              {t('notConnected')}
            </span>
          )}
        </div>

        {!isConnected && (
          <>
            <p className="text-sm text-gray-500 mb-4">{t('notConnectedDesc')}</p>
            <button onClick={handleConnect} disabled={connecting} className="btn-primary w-full sm:w-auto min-h-10 inline-flex items-center justify-center gap-2">
              {connecting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t('connecting')}
                </>
              ) : (
                t('connectButton')
              )}
            </button>
          </>
        )}

        {isConnected && !isVerified && (
          <>
            <div className="space-y-3 mb-5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">{t('verification')}</span>
                <StatusBadge status={verificationStatus} />
              </div>
            </div>
            <div className="mb-5 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm text-amber-800">
                {email ? t('pendingNote', { email }) : t('pendingNoteNoEmail')}
              </p>
            </div>
            <button onClick={handleRefresh} disabled={refreshing} className="btn-ghost border border-gray-200 rounded-lg px-4 py-2 min-h-10 inline-flex items-center justify-center gap-2">
              {refreshing ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-gray-400/30 border-t-gray-500 rounded-full animate-spin" />
                  {t('refreshing')}
                </>
              ) : (
                t('refreshButton')
              )}
            </button>
          </>
        )}

        {isVerified && (
          <>
            <div className="space-y-3 mb-5">
              {merchantId && (
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-gray-500 shrink-0">{t('merchantId')}</span>
                  <span className="text-gray-900 font-mono text-xs break-all text-right">{merchantId}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">{t('verification')}</span>
                <StatusBadge status={verificationStatus} />
              </div>
              {connectedAt && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">{t('connectedSince')}</span>
                  <span className="text-gray-900 text-xs">
                    {new Date(connectedAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={handleRefresh} disabled={refreshing} className="btn-ghost border border-gray-200 rounded-lg px-4 py-2 min-h-10 inline-flex items-center justify-center gap-2">
                {refreshing ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-gray-400/30 border-t-gray-500 rounded-full animate-spin" />
                    {t('refreshing')}
                  </>
                ) : (
                  t('refreshButton')
                )}
              </button>
              <button onClick={handleDisconnect} disabled={disconnecting} className="btn-danger min-h-10">
                {disconnecting ? t('disconnecting') : t('disconnectButton')}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="bg-gray-50 rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">{t('howItWorks')}</h2>
        <ul className="space-y-2 text-sm text-gray-600">
          <li className="flex items-start gap-2">
            <span className="mt-1 w-4 h-4 rounded-full bg-gray-200 text-gray-600 text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
            {t('howItWorksStep1')}
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 w-4 h-4 rounded-full bg-gray-200 text-gray-600 text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
            {t('howItWorksStep2')}
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 w-4 h-4 rounded-full bg-gray-200 text-gray-600 text-[10px] font-bold flex items-center justify-center shrink-0">3</span>
            {t('howItWorksStep3')}
          </li>
        </ul>
      </div>
      </div>
    </div>
  )
}
