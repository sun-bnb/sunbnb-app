'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import QRCode from 'qrcode'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import FormControl from '@mui/material/FormControl'

/**
 * Full-screen "Collect payment" view — entity-agnostic.
 *
 * The three operations are injected as thunks so this modal works for BOTH
 * sunbed reservations and equipment rental bookings. The caller binds the
 * concrete server actions (and their ids/keys) before passing them in.
 *
 * When the caller passes `terminals` (a site's registered Viva Cloud Terminal
 * devices), a method chooser (QR / Tap card) is shown first; with zero
 * terminals the chooser is skipped entirely and behaviour is byte-identical
 * to before (QR immediately) — cash is never a choice here, that's the
 * separate Settle path.
 *
 * On choosing QR, `actions.create({method:'qr'})` returns an amount + checkout
 * URL (or a demo flag) and the customer scans the QR on their own phone. On
 * choosing Tap card, `actions.create({method:'card', terminalId})` starts a
 * Viva Cloud Terminal sale — no QR, the guest taps the physical terminal.
 * Either way this screen polls `actions.poll()` every ~2.5s and reflects the
 * live result. Closing before payment calls `actions.cancel()` so the entity
 * reverts to cash and is never stranded as `processing` — for a card
 * collection whose abort raced the card being read, `cancel()` may itself
 * come back `processing` (the terminal already has an authorization in
 * flight); the modal stays open and keeps polling rather than guessing.
 *
 * Chrome mirrors CreateRentalModal: a bottom sheet on mobile, centered card on
 * desktop, with `dark:` variants (rendered inside the manage page's `.dark` root).
 */

export type CollectActions = {
  /** Initiate the payment — called once the operator picks a method. */
  create: (_choice: { method: 'qr' | 'card'; terminalId?: string }) => Promise<{
    status: string
    amount?: number
    demo?: boolean
    card?: boolean
    checkoutUrl?: string
    errors?: string[]
  }>
  /** Poll for the live payment status. */
  poll: () => Promise<{ status: string; paymentStatus?: string; errors?: string[] }>
  /** Cancel an unpaid collection so the entity reverts to cash. */
  cancel: (_choice?: { terminalId?: string }) => Promise<{ status: string; paymentStatus?: string }>
}

export interface CollectTerminalOption {
  terminalId: string
  label: string | null
}

type Phase = 'choosing' | 'creating' | 'awaiting' | 'canceling' | 'complete' | 'failed' | 'error'

const POLL_MS = 2500

export default function CollectPaymentModal({
  actions,
  onClose,
  onSettled,
  title,
  terminals = [],
}: {
  actions: CollectActions
  onClose: () => void
  /** Called after a terminal result so the parent can refresh the grid. */
  onSettled: () => void
  /** Override the modal title; defaults to the `CollectPayment.title` i18n key. */
  title?: string
  /**
   * Registered Viva Cloud Terminal devices for this site. Empty (default)
   * skips the method chooser entirely — QR starts immediately, same as
   * before card-present existed. Non-empty shows a QR / Tap card chooser.
   */
  terminals?: CollectTerminalOption[]
}) {
  const t = useTranslations('CollectPayment')
  const [phase, setPhase] = useState<Phase>(terminals.length > 0 ? 'choosing' : 'creating')
  const [amount, setAmount] = useState<number | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [isDemo, setIsDemo] = useState(false)
  const [isCard, setIsCard] = useState(false)
  const [selectedTerminalId, setSelectedTerminalId] = useState(terminals[0]?.terminalId ?? '')
  const [activeTerminalId, setActiveTerminalId] = useState<string | undefined>(undefined)
  const [activeTerminalLabel, setActiveTerminalLabel] = useState<string | null>(null)
  const [raced, setRaced] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // Guard so the create effect runs exactly once even under StrictMode.
  const startedRef = useRef(false)
  const settledRef = useRef(false)

  const startCollect = useCallback(async (choice: { method: 'qr' | 'card'; terminalId?: string }) => {
    setPhase('creating')
    setIsCard(choice.method === 'card')
    if (choice.method === 'card') {
      setActiveTerminalId(choice.terminalId)
      const term = terminals.find(x => x.terminalId === choice.terminalId)
      setActiveTerminalLabel(term?.label ?? term?.terminalId ?? null)
    }
    const res = await actions.create(choice)
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
    if (res.card) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, terminals])

  // ── No terminals registered → skip the chooser, start QR immediately ─────
  useEffect(() => {
    if (startedRef.current) return
    if (terminals.length > 0) return
    startedRef.current = true
    void startCollect({ method: 'qr' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleChoose = useCallback((method: 'qr' | 'card') => {
    if (startedRef.current) return
    startedRef.current = true
    void startCollect(
      method === 'card'
        ? { method, terminalId: selectedTerminalId || terminals[0]?.terminalId }
        : { method },
    )
  }, [startCollect, selectedTerminalId, terminals])

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
      // 'processing' (including a raced cancel) → keep polling; complete/failed
      // above are the only terminal outcomes.
    }, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // ── Close: abandon an unpaid collection so the entity reverts to cash ─────
  const handleClose = useCallback(() => {
    if (raced) return // an authorization is racing the abort — never guess, keep polling
    if (!settledRef.current && (phase === 'awaiting' || phase === 'creating')) {
      // The cancel now makes a network call (Mollie DELETE / Viva abort) — show
      // a 'canceling' spinner so the operator sees progress, not a frozen modal.
      setPhase('canceling')
      actions.cancel(isCard ? { terminalId: activeTerminalId } : undefined)
        .then((res) => {
          if (isCard && res.status === 'ok' && res.paymentStatus === 'processing') {
            // The abort raced the card being read — the terminal may still
            // resolve to a real charge. Stay open and keep polling instead of
            // reverting to cash blind.
            setRaced(true)
            setPhase('awaiting')
            return
          }
          onSettled()
          onClose()
        })
        .catch(() => { onSettled(); onClose() })
      return
    }
    onClose()
  }, [phase, actions, onClose, onSettled, isCard, activeTerminalId, raced])

  const amountLabel = amount != null ? `€${amount.toFixed(2)}` : '—'
  const modalTitle = title ?? t('title')
  const canDismiss = phase !== 'canceling' && !raced

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget && canDismiss) handleClose() }}
    >
      <div className="bg-white dark:bg-gray-900 dark:text-gray-100 w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-xl overflow-hidden max-h-[92vh] sm:max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b-2 border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-black text-gray-900 dark:text-gray-100">💳 {modalTitle}</h2>
          <button
            onClick={handleClose}
            aria-label={t('close')}
            disabled={!canDismiss}
            className="text-gray-400 dark:text-gray-500 text-4xl leading-none p-3 -mr-2 disabled:opacity-30"
          >&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-center">
          {/* Amount — hidden during the method chooser (no amount known yet) */}
          {phase !== 'choosing' && (
            <div>
              <div className="text-sm font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">{t('amountDue')}</div>
              <div className="text-4xl font-black tabular-nums">{amountLabel}</div>
            </div>
          )}

          {phase === 'choosing' && (
            <div className="py-4 space-y-3">
              <div className="text-sm font-bold text-gray-500 dark:text-gray-400">{t('chooseMethod')}</div>
              <button
                onClick={() => handleChoose('qr')}
                className="w-full font-black py-4 rounded-2xl text-lg select-none bg-gray-100 text-gray-800 active:bg-gray-200 dark:bg-gray-800 dark:text-gray-100"
              >
                📱 {t('methodQr')}
              </button>
              {terminals.length > 1 && (
                <FormControl fullWidth size="small">
                  <Select
                    value={selectedTerminalId}
                    onChange={e => setSelectedTerminalId(e.target.value)}
                    displayEmpty
                    aria-label={t('terminal')}
                    sx={{ fontSize: '0.9rem', borderRadius: '8px' }}
                  >
                    {terminals.map(term => (
                      <MenuItem key={term.terminalId} value={term.terminalId}>
                        {term.label || term.terminalId}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              <button
                onClick={() => handleChoose('card')}
                className="w-full font-black py-4 rounded-2xl text-lg select-none bg-accent text-white active:bg-accent-hover"
              >
                💳 {t('methodCard')}
              </button>
            </div>
          )}

          {phase === 'creating' && (
            <div className="py-10 text-gray-500 dark:text-gray-400 font-bold">{t('creating')}</div>
          )}

          {phase === 'awaiting' && (
            <>
              {isCard ? (
                <div className={`py-8 px-4 rounded-2xl border-2 font-bold ${
                  raced
                    ? 'border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/40 text-amber-700 dark:text-amber-300'
                    : 'border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800/40 text-blue-700 dark:text-blue-300'
                }`}>
                  {raced ? t('cardAlreadyRead') : t('tapCard', { label: activeTerminalLabel ?? '' })}
                </div>
              ) : isDemo ? (
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

          {phase === 'canceling' && (
            <div className="py-10 flex flex-col items-center gap-4">
              <span className="w-8 h-8 border-4 border-gray-300 border-t-gray-600 dark:border-gray-600 dark:border-t-gray-200 rounded-full animate-spin" aria-hidden="true" />
              <div className="text-gray-500 dark:text-gray-400 font-bold">{t('canceling')}</div>
            </div>
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
              <div className="mt-1 text-sm font-bold text-red-600 dark:text-red-400">{isCard ? t('failedBodyCard') : t('failedBody')}</div>
            </div>
          )}

          {phase === 'error' && (
            <div className="py-8 px-4 rounded-2xl border-2 border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800/40 text-red-700 dark:text-red-400 font-black">
              {errorMsg ?? t('errorGeneric')}
            </div>
          )}
        </div>

        {/* Footer — hidden during the method chooser (nothing to close/cancel yet) */}
        {phase !== 'choosing' && (
          <div className="px-4 py-3 border-t-2 border-gray-200 dark:border-gray-700"
               style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0.75rem))' }}>
            <button
              onClick={handleClose}
              disabled={!canDismiss}
              className={`w-full font-black py-4 rounded-2xl text-lg select-none transition-colors disabled:opacity-50 ${
                phase === 'complete'
                  ? 'bg-green-600 text-white active:bg-green-700'
                  : 'bg-gray-200 text-gray-700 active:bg-gray-300 dark:bg-gray-800 dark:text-gray-200'
              }`}
            >
              {phase === 'complete'
                ? t('done')
                : phase === 'canceling'
                  ? t('canceling')
                  : phase === 'awaiting' && isCard
                    ? t('cancel')
                    : t('close')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
