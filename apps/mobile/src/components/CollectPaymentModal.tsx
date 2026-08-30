/**
 * Entity-agnostic collect modal — RN port of the web CollectPaymentModal
 * (apps/partner/.../CollectPaymentModal.tsx). The caller injects the
 * create/poll/cancel triple; this component owns the phases.
 *
 * Two rails: QR (the guest pays on their own phone; also demo mode) and
 * "Tap card" — the server pushes the sale to a Viva terminal (the staff
 * phone's viva.com Terminal app) and we poll exactly like QR ([[track:024]]
 * W8). The method chooser appears only when the caller passes a non-empty
 * `terminals` list; without terminals the QR flow starts immediately, as
 * before. Cancel semantics mirror the machine: abandoning a collect reverts to
 * unsettled cash — the bed is never freed — except when the terminal already
 * read the card (`processing`), in which case we keep polling.
 */
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { CheckIcon, CloseIcon, ContactlessIcon, QrIcon } from '@/components/icons'
import type { ActionResult, CollectChoice, VivaTerminal } from '@/lib/api'
import { colors } from '@/theme'

const POLL_MS = 2500

export interface CollectActions {
  create: (
    choice: CollectChoice,
  ) => Promise<ActionResult & { amount?: number; demo?: boolean; checkoutUrl?: string; card?: boolean }>
  poll: () => Promise<ActionResult & { paymentStatus?: string }>
  cancel: (choice?: { terminalId?: string }) => Promise<ActionResult & { paymentStatus?: string }>
}

type Phase =
  | 'choose'
  | 'pick-terminal'
  | 'creating'
  | 'awaiting'
  | 'canceling'
  | 'complete'
  | 'failed'
  | 'error'

export default function CollectPaymentModal({
  actions,
  onSettled,
  onClose,
  subtitle,
  terminals = [],
  selectedTerminalId = null,
}: {
  actions: CollectActions
  onSettled: () => void
  onClose: () => void
  subtitle?: string
  /** Site terminals; non-empty enables the QR / Tap card chooser. */
  terminals?: VivaTerminal[]
  /** The phone's persisted terminal choice (see lib/terminal.ts). */
  selectedTerminalId?: string | null
}) {
  const hasTerminals = terminals.length > 0
  const [phase, setPhase] = useState<Phase>(hasTerminals ? 'choose' : 'creating')
  const [terminal, setTerminal] = useState<VivaTerminal | null>(null)
  const [cardRead, setCardRead] = useState(false)
  const [amount, setAmount] = useState<number | null>(null)
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)
  const [isDemo, setIsDemo] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const startedRef = useRef(false)

  function start(choice: CollectChoice) {
    if (startedRef.current) return
    startedRef.current = true
    setPhase('creating')
    actions
      .create(choice)
      .then(res => {
        if (res.status !== 'ok') {
          setErrorMsg(res.errors?.[0] ?? 'Could not start the payment.')
          setPhase('error')
          return
        }
        if (typeof res.amount === 'number') setAmount(res.amount)
        if (res.demo) setIsDemo(true)
        else if (res.checkoutUrl) setCheckoutUrl(res.checkoutUrl)
        setPhase('awaiting')
      })
      .catch(() => {
        setErrorMsg('Could not reach the server.')
        setPhase('error')
      })
  }

  function startCard(t: VivaTerminal) {
    setTerminal(t)
    start({ method: 'card', terminalId: t.terminalId })
  }

  function chooseCard() {
    const preselected = terminals.find(t => t.terminalId === selectedTerminalId)
    if (preselected) return startCard(preselected)
    if (terminals.length === 1) return startCard(terminals[0]!)
    setPhase('pick-terminal')
  }

  // No terminals → QR immediately (unchanged behaviour). Mount-once: start()
  // guards on startedRef, so re-runs are no-ops.
  useEffect(() => {
    if (!hasTerminals) start({ method: 'qr' })
  })

  useEffect(() => {
    if (phase !== 'awaiting') return
    const timer = setInterval(async () => {
      try {
        const res = await actions.poll()
        if (res.status !== 'ok') return
        if (res.paymentStatus === 'complete') {
          setPhase('complete')
          onSettled()
        } else if (res.paymentStatus === 'failed') {
          setPhase('failed')
          onSettled()
        }
      } catch {
        // transient poll failure — keep waiting
      }
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [phase, actions, onSettled])

  function close() {
    if (phase === 'canceling') return
    if (phase === 'awaiting' || phase === 'creating') {
      setPhase('canceling')
      actions
        .cancel(terminal ? { terminalId: terminal.terminalId } : undefined)
        .then(res => {
          if (res.status === 'ok' && res.paymentStatus === 'processing') {
            // The terminal already read the card — the sale may still land.
            setCardRead(true)
            setPhase('awaiting')
            return
          }
          if (res.status === 'ok' && res.paymentStatus === 'complete') {
            setPhase('complete')
            onSettled()
            return
          }
          onSettled()
          onClose()
        })
        .catch(() => {
          onSettled()
          onClose()
        })
      return
    }
    onClose()
  }

  const busy = phase === 'canceling'

  return (
    <Modal transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} disabled={busy} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.title}>Collect payment</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <Pressable onPress={close} disabled={busy} style={[styles.closeBtn, busy && { opacity: 0.3 }]}>
              <CloseIcon />
            </Pressable>
          </View>

          {phase !== 'choose' && phase !== 'pick-terminal' && (
            <View style={styles.amountBlock}>
              <Text style={styles.amountCaption}>AMOUNT DUE</Text>
              <Text style={styles.amount}>{amount !== null ? `€${amount.toFixed(2)}` : '—'}</Text>
            </View>
          )}

          {phase === 'choose' && (
            <View style={styles.chooser}>
              <Text style={styles.caption}>How is the guest paying?</Text>
              <View style={styles.chooserRow}>
                <Pressable style={[styles.methodBtn, { backgroundColor: colors.info }]} onPress={() => start({ method: 'qr' })}>
                  <QrIcon size={26} />
                  <Text style={styles.methodText}>QR</Text>
                  <Text style={styles.methodSub}>Guest's phone</Text>
                </Pressable>
                <Pressable style={[styles.methodBtn, { backgroundColor: colors.accent }]} onPress={chooseCard}>
                  <ContactlessIcon size={26} />
                  <Text style={styles.methodText}>Tap card</Text>
                  <Text style={styles.methodSub}>On this terminal</Text>
                </Pressable>
              </View>
            </View>
          )}

          {phase === 'pick-terminal' && (
            <View style={styles.chooser}>
              <Text style={styles.caption}>Which terminal?</Text>
              {terminals.map(t => (
                <Pressable key={t.id} style={styles.terminalRow} onPress={() => startCard(t)}>
                  <ContactlessIcon color={colors.body} />
                  <Text style={styles.terminalText} numberOfLines={1}>{t.label}</Text>
                  {t.terminalId === selectedTerminalId && <CheckIcon />}
                </Pressable>
              ))}
              <Pressable onPress={() => setPhase('choose')} style={styles.linkBtn}>
                <Text style={styles.linkText}>Back</Text>
              </Pressable>
            </View>
          )}

          {phase === 'creating' && (
            <Text style={styles.mutedCenter}>{terminal ? 'Sending to the terminal…' : 'Preparing payment…'}</Text>
          )}

          {phase === 'awaiting' && (
            <View style={styles.awaiting}>
              {terminal ? (
                <View style={styles.tapCard}>
                  <ContactlessIcon size={44} color={colors.heading} />
                  <Text style={styles.scanTitle}>Tap the card on {terminal.label}</Text>
                  {cardRead && (
                    <Text style={styles.tapNote}>Card already read — waiting for the terminal…</Text>
                  )}
                </View>
              ) : isDemo ? (
                <View style={styles.demoCard}>
                  <Text style={styles.demoText}>Demo mode — the payment completes automatically.</Text>
                </View>
              ) : checkoutUrl ? (
                <View style={styles.qrWrap}>
                  <Text style={styles.scanTitle}>Scan to pay</Text>
                  <View style={styles.qrBox}>
                    <QRCode value={checkoutUrl} size={220} />
                  </View>
                </View>
              ) : (
                <Text style={styles.mutedCenter}>Preparing payment…</Text>
              )}
              <View style={styles.waitRow}>
                <ActivityIndicator color={colors.info} />
                <Text style={styles.waitText}>Waiting for payment…</Text>
              </View>
            </View>
          )}

          {phase === 'canceling' && (
            <View style={styles.awaiting}>
              <ActivityIndicator size="large" color={colors.muted} />
              <Text style={styles.mutedCenter}>Canceling…</Text>
            </View>
          )}

          {phase === 'complete' && (
            <View style={styles.resultCardGreen}>
              <Text style={styles.resultEmoji}>✅</Text>
              <Text style={styles.resultTitleGreen}>Paid</Text>
            </View>
          )}

          {phase === 'failed' && (
            <View style={styles.resultCardRed}>
              <Text style={styles.resultTitleRed}>{terminal ? 'Declined' : 'Payment failed'}</Text>
              <Text style={styles.resultSubRed}>
                {terminal ? 'Declined — still cash' : 'Still cash — you can try again.'}
              </Text>
            </View>
          )}

          {phase === 'error' && (
            <View style={styles.resultCardRed}>
              <Text style={styles.resultTitleRed}>{errorMsg ?? 'Could not start the payment.'}</Text>
            </View>
          )}

          <Pressable
            onPress={close}
            disabled={busy}
            style={[
              styles.footerBtn,
              phase === 'complete' && { backgroundColor: '#16a34a' },
              busy && { opacity: 0.5 },
            ]}
          >
            <Text style={[styles.footerBtnText, phase === 'complete' && { color: '#ffffff' }]}>
              {phase === 'complete'
                ? 'Done'
                : busy
                  ? 'Canceling…'
                  : phase === 'awaiting' && terminal
                    ? 'Cancel'
                    : 'Close'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.cardBg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 34,
    gap: 14,
  },
  handle: { width: 36, height: 4, borderRadius: 999, backgroundColor: colors.borderInput, alignSelf: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 17, fontWeight: '600', color: colors.heading },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 1 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 999, backgroundColor: colors.chipBg,
    alignItems: 'center', justifyContent: 'center',
  },
  amountBlock: { alignItems: 'center', gap: 2 },
  amountCaption: { fontSize: 11, fontWeight: '600', letterSpacing: 1, color: colors.faint },
  amount: { fontSize: 42, fontWeight: '900', color: colors.heading, fontVariant: ['tabular-nums'] },
  caption: { fontSize: 13, color: colors.muted },
  chooser: { gap: 10 },
  chooserRow: { flexDirection: 'row', gap: 10 },
  methodBtn: {
    flex: 1, height: 96, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  methodText: { fontSize: 15, fontWeight: '700', color: '#ffffff' },
  methodSub: { fontSize: 11, color: 'rgba(255,255,255,0.75)' },
  terminalRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12,
    borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardBg,
  },
  terminalText: { fontSize: 15, color: colors.heading, flexGrow: 1, flexShrink: 1 },
  linkBtn: { alignSelf: 'center', paddingVertical: 6 },
  linkText: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  mutedCenter: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  awaiting: { alignItems: 'center', gap: 14 },
  tapCard: {
    alignItems: 'center', gap: 10, alignSelf: 'stretch', padding: 20, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.pageBg,
  },
  tapNote: { fontSize: 13, color: '#b45309', textAlign: 'center' },
  demoCard: {
    backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 12,
    padding: 14, alignSelf: 'stretch',
  },
  demoText: { fontSize: 13, color: '#1d4ed8', textAlign: 'center' },
  qrWrap: { alignItems: 'center', gap: 10 },
  scanTitle: { fontSize: 15, fontWeight: '700', color: colors.heading, textAlign: 'center' },
  qrBox: {
    padding: 12, backgroundColor: '#ffffff', borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
  },
  waitRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  waitText: { fontSize: 13, color: colors.muted },
  resultCardGreen: {
    backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0', borderRadius: 12,
    padding: 20, alignItems: 'center', gap: 6,
  },
  resultEmoji: { fontSize: 40 },
  resultTitleGreen: { fontSize: 17, fontWeight: '700', color: '#15803d' },
  resultCardRed: {
    backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 12,
    padding: 16, alignItems: 'center', gap: 4,
  },
  resultTitleRed: { fontSize: 15, fontWeight: '600', color: '#b91c1c', textAlign: 'center' },
  resultSubRed: { fontSize: 13, color: '#dc2626' },
  footerBtn: {
    height: 48, borderRadius: 10, backgroundColor: colors.chipBg,
    alignItems: 'center', justifyContent: 'center',
  },
  footerBtnText: { fontSize: 15, fontWeight: '600', color: colors.body },
})
