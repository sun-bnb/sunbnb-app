'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import QRCode from 'qrcode'

/**
 * Full-screen "Collect payment" view — entity-agnostic.
 *
 * The three operations are injected as thunks so this modal works for BOTH
 * sunbed reservations and equipment rental bookings. The caller binds the
 * concrete server actions (and their ids/keys) before passing them in.
 *
 * On open it calls `actions.create()` which returns an amount + checkout URL
 * (or a demo flag). The customer scans the QR and pays on their own phone;
 * this screen polls `actions.poll()` every ~2.5s and reflects the live result.
 * Closing before payment calls `actions.cancel()` so the entity reverts to
 * cash and is never stranded as `processing`.
 *
 * Chrome mirrors CreateRentalModal: a bottom sheet on mobile, centered card on
 * desktop, with `dark:` variants (rendered inside the manage page's `.dark` root).
 */

export type CollectActions = {
  /** Initiate the payment — called once on open. */
  create: () => Promise<{ status: string; amount?: number; demo?: boolean; checkoutUrl?: string; errors?: string[] }>
  /** Poll for the live payment status. */
  poll: () => Promise<{ status: string; paymentStatus?: string; errors?: string[] }>
  /** Cancel an unpaid collection so the entity reverts to cash. */
  cancel: () => Promise<{ status: string; paymentStatus?: string }>
}

type Phase = 'creating' | 'awaiting' | 'complete' | 'failed' | 'error'

const POLL_MS = 2500

export default function CollectPaymentModal({
  actions,
  onClose,
  onSettled,
  title,
}: {
  actions: CollectActions
  onClose: () => void
  /** Called after a terminal result so the parent can refresh the grid. */
  onSettled: () => void
  /** Override the modal title; defaults to the `CollectPayment.title` i18n key. */
  title?: string
}) {
  const t = useTranslations('CollectPayment')
  const [phase, setPhase] = useState<Phase>('creating')
  const [amount, setAmount] = useState<number | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [isDemo, setIsDemo] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // Guard so the create effect runs exactly once even under StrictMode.
  const startedRef = useRef(false)
  const settledRef = useRef(false)

  // ── Create the payment on open ────────────────────────────────────────────
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    ;(async () => {
      const res = await actions.create()
      if (res.status !== 'ok') {
        setErrorMsg(res.errors?.[0] ?? t('errorGeneric'))
        setPhase('error')
        return
      }
      setAmount(res.amount ?? null)
      if (res.demo) {
        setIsDemo(true)
        setPhase('awaiting')
        return
      }
      if (res.checkoutUrl) {
        try {
          const url = await QRCode.toDataURL(res.checkoutUrl, { width: 320, margin: 1 })
          setQrDataUrl(url)
        } catch {
          // QR render failure is non-fatal — the poll still resolves the payment.
        }
      }
      setPhase('awaiting')
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Poll for the live status while awaiting ───────────────────────────────
  useEffect(() => {
    if (phase !== 'awaiting') return
    let cancelled = false
    const id = setInterval(async () => {
      const res = await actions.poll()
      if (cancelled || res.status !== 'ok') return
      if (res.paymentStatus === 'complete') {
        settledRef.current = true
        setPhase('complete')
        onSettled()
      } else if (res.paymentStatus === 'failed') {
        settledRef.current = true
        setPhase('failed')
        onSettled()
      }
    }, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── Close: abandon an unpaid collection so the entity reverts to cash ─────
  const handleClose = useCallback(() => {
    if (!settledRef.current && (phase === 'awaiting' || phase === 'creating')) {
      // Fire-and-forget; the parent refreshes on close regardless.
      actions.cancel().finally(onSettled)
    }
    onClose()
  }, [phase, actions, onClose, onSettled])

  const amountLabel = amount != null ? `€${amount.toFixed(2)}` : '—'
  const modalTitle = title ?? t('title')

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div className="bg-white dark:bg-gray-900 dark:text-gray-100 w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-xl overflow-hidden max-h-[92vh] sm:max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b-2 border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-black text-gray-900 dark:text-gray-100">💳 {modalTitle}</h2>
          <button onClick={handleClose} aria-label={t('close')} className="text-gray-400 dark:text-gray-500 text-4xl leading-none p-3 -mr-2">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-center">
          {/* Amount — always shown once known */}
          <div>
            <div className="text-sm font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">{t('amountDue')}</div>
            <div className="text-4xl font-black tabular-nums">{amountLabel}</div>
          </div>

          {phase === 'creating' && (
            <div className="py-10 text-gray-500 dark:text-gray-400 font-bold">{t('creating')}</div>
          )}

          {phase === 'awaiting' && (
            <>
              {isDemo ? (
                <div className="py-8 px-4 rounded-2xl border-2 border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800/40 text-blue-700 dark:text-blue-300 font-bold">
                  {t('demoNote')}
                </div>
              ) : qrDataUrl ? (
                <div className="space-y-2">
                  <div className="font-bold text-gray-700 dark:text-gray-200">{t('scanToPay')}</div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrDataUrl} alt={t('scanToPay')} className="mx-auto w-64 h-64 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white" />
                </div>
              ) : (
                <div className="py-10 text-gray-500 dark:text-gray-400 font-bold">{t('creating')}</div>
              )}
              <div className="flex items-center justify-center gap-2 text-gray-500 dark:text-gray-400 font-bold">
                <span className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 dark:border-gray-600 dark:border-t-gray-200 rounded-full animate-spin" />
                {t('waiting')}
              </div>
            </>
          )}

          {phase === 'complete' && (
            <div className="py-8 px-4 rounded-2xl border-2 border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-800/40">
              <div className="text-5xl">✅</div>
              <div className="mt-2 text-xl font-black text-green-700 dark:text-green-400">{t('paid')}</div>
            </div>
          )}

          {phase === 'failed' && (
            <div className="py-8 px-4 rounded-2xl border-2 border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800/40">
              <div className="text-xl font-black text-red-700 dark:text-red-400">{t('failedTitle')}</div>
              <div className="mt-1 text-sm font-bold text-red-600 dark:text-red-400">{t('failedBody')}</div>
            </div>
          )}

          {phase === 'error' && (
            <div className="py-8 px-4 rounded-2xl border-2 border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800/40 text-red-700 dark:text-red-400 font-black">
              {errorMsg ?? t('errorGeneric')}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t-2 border-gray-200 dark:border-gray-700"
             style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0.75rem))' }}>
          <button
            onClick={handleClose}
            className={`w-full font-black py-4 rounded-2xl text-lg select-none transition-colors ${
              phase === 'complete'
                ? 'bg-green-600 text-white active:bg-green-700'
                : 'bg-gray-200 text-gray-700 active:bg-gray-300 dark:bg-gray-800 dark:text-gray-200'
            }`}
          >
            {phase === 'complete' ? t('done') : t('close')}
          </button>
        </div>
      </div>
    </div>
  )
}
