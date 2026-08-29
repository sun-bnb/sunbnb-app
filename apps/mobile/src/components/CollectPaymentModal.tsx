/**
 * Entity-agnostic QR/demo collect modal — RN port of the web
 * CollectPaymentModal (apps/partner/.../CollectPaymentModal.tsx). The caller
 * injects the create/poll/cancel triple; this component owns the phases.
 * Cancel semantics mirror the machine: abandoning a collect reverts to
 * unsettled cash — the bed is never freed.
 */
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { CloseIcon } from '@/components/icons'
import type { ActionResult } from '@/lib/api'
import { colors } from '@/theme'

const POLL_MS = 2500

export interface CollectActions {
  create: () => Promise<ActionResult & { amount?: number; demo?: boolean; checkoutUrl?: string }>
  poll: () => Promise<ActionResult & { paymentStatus?: string }>
  cancel: () => Promise<ActionResult>
}

type Phase = 'creating' | 'awaiting' | 'canceling' | 'complete' | 'failed' | 'error'

export default function CollectPaymentModal({
  actions,
  onSettled,
  onClose,
  subtitle,
}: {
  actions: CollectActions
  onSettled: () => void
  onClose: () => void
  subtitle?: string
}) {
  const [phase, setPhase] = useState<Phase>('creating')
  const [amount, setAmount] = useState<number | null>(null)
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)
  const [isDemo, setIsDemo] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    actions
      .create()
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
  }, [actions])

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
        .cancel()
        .catch(() => undefined)
        .finally(() => {
          onSettled()
          onClose()
        })
      return
    }
    onClose()
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} disabled={phase === 'canceling'} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.title}>Collect payment</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <Pressable
              onPress={close}
              disabled={phase === 'canceling'}
              style={[styles.closeBtn, phase === 'canceling' && { opacity: 0.3 }]}
            >
              <CloseIcon />
            </Pressable>
          </View>

          <View style={styles.amountBlock}>
            <Text style={styles.amountCaption}>AMOUNT DUE</Text>
            <Text style={styles.amount}>{amount !== null ? `€${amount.toFixed(2)}` : '—'}</Text>
          </View>

          {phase === 'creating' && <Text style={styles.mutedCenter}>Preparing payment…</Text>}

          {phase === 'awaiting' && (
            <View style={styles.awaiting}>
              {isDemo ? (
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
              <Text style={styles.resultTitleRed}>Payment failed</Text>
              <Text style={styles.resultSubRed}>Still cash — you can try again.</Text>
            </View>
          )}

          {phase === 'error' && (
            <View style={styles.resultCardRed}>
              <Text style={styles.resultTitleRed}>{errorMsg ?? 'Could not start the payment.'}</Text>
            </View>
          )}

          <Pressable
            onPress={close}
            disabled={phase === 'canceling'}
            style={[
              styles.footerBtn,
              phase === 'complete' && { backgroundColor: '#16a34a' },
              phase === 'canceling' && { opacity: 0.5 },
            ]}
          >
            <Text style={[styles.footerBtnText, phase === 'complete' && { color: '#ffffff' }]}>
              {phase === 'complete' ? 'Done' : phase === 'canceling' ? 'Canceling…' : 'Close'}
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
  closeBtnText: { fontSize: 15, color: colors.muted },
  amountBlock: { alignItems: 'center', gap: 2 },
  amountCaption: { fontSize: 11, fontWeight: '600', letterSpacing: 1, color: colors.faint },
  amount: { fontSize: 42, fontWeight: '900', color: colors.heading, fontVariant: ['tabular-nums'] },
  mutedCenter: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  awaiting: { alignItems: 'center', gap: 14 },
  demoCard: {
    backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 12,
    padding: 14, alignSelf: 'stretch',
  },
  demoText: { fontSize: 13, color: '#1d4ed8', textAlign: 'center' },
  qrWrap: { alignItems: 'center', gap: 10 },
  scanTitle: { fontSize: 15, fontWeight: '700', color: colors.heading },
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
