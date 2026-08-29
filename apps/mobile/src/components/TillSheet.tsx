/**
 * Per-worker till sheet — RN port of the web TillSheet on the day-anchored
 * till model (track 016): "today" leads, carry-over from previous days is
 * swept in on close; there is no partial close.
 */
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { CloseIcon } from '@/components/icons'
import { rpc, type ActionResult } from '@/lib/api'
import { workerInitials } from '@/lib/worker'
import { colors } from '@/theme'

type Phase = 'loading' | 'ready' | 'confirming' | 'closing' | 'closed' | 'error'

interface TillStatus {
  total: number
  count: number
  today: { total: number; count: number }
  carryOver: { total: number; count: number; oldestAt?: string | null }
}

export default function TillSheet({
  siteId, accessKey, worker, onClose, onClosed,
}: {
  siteId: string
  accessKey: string
  worker: { id: string; name: string }
  onClose: () => void
  onClosed: () => void
}) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [status, setStatus] = useState<TillStatus | null>(null)
  const [closeResult, setCloseResult] = useState<(TillStatus & { carryOverAmount?: number }) | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    rpc<ActionResult & TillStatus>('getTillStatus', [siteId, worker.id, accessKey])
      .then(res => {
        if (res.status === 'ok') {
          setStatus(res)
          setPhase('ready')
        } else {
          setErrorMsg(res.errors?.[0] ?? 'Something went wrong.')
          setPhase('error')
        }
      })
      .catch(() => {
        setErrorMsg('Could not reach the server.')
        setPhase('error')
      })
  }, [siteId, worker.id, accessKey])

  function confirmClose() {
    setPhase('closing')
    rpc<ActionResult & TillStatus & { carryOverAmount?: number }>('closeTill', [siteId, worker.id, accessKey])
      .then(res => {
        if (res.status === 'ok') {
          setCloseResult(res)
          setPhase('closed')
          onClosed()
        } else {
          setErrorMsg(res.errors?.[0] ?? 'Something went wrong.')
          setPhase('error')
        }
      })
      .catch(() => {
        setErrorMsg('Could not reach the server.')
        setPhase('error')
      })
  }

  const isEmpty = (status?.total ?? 0) === 0
  const carry = status?.carryOver
  const oldest = carry?.oldestAt
    ? new Date(carry.oldestAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : null

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} disabled={phase === 'closing'} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{workerInitials(worker.name)}</Text>
            </View>
            <Text style={styles.title}>{worker.name}&#8217;s till</Text>
            <View style={{ flexGrow: 1 }} />
            <Pressable onPress={onClose} style={styles.closeBtn} disabled={phase === 'closing'}>
              <CloseIcon />
            </Pressable>
          </View>

          {phase === 'loading' && <ActivityIndicator color={colors.accent} style={{ marginVertical: 30 }} />}

          {phase === 'error' && (
            <View style={styles.errCard}>
              <Text style={styles.errText}>{errorMsg}</Text>
            </View>
          )}

          {(phase === 'ready' || phase === 'confirming' || phase === 'closing') && status && (
            <>
              <View style={styles.todayBlock}>
                <Text style={styles.todayCaption}>TODAY</Text>
                <Text style={styles.todayAmount}>€{status.today.total.toFixed(2)}</Text>
                <Text style={styles.todaySub}>{status.today.count} cash sales today</Text>
              </View>
              {carry && carry.count > 0 && (
                <View style={styles.amberCard}>
                  <Text style={styles.amberText}>
                    Uncounted cash from {oldest}: <Text style={{ fontWeight: '700' }}>€{carry.total.toFixed(2)}</Text>{' '}
                    ({carry.count} sales) — included when you close.
                  </Text>
                </View>
              )}
              {phase !== 'ready' && !isEmpty && (
                <View style={[styles.amberCard, { alignItems: 'center', gap: 4 }]}>
                  <Text style={styles.confirmTitle}>
                    Hand over €{status.total.toFixed(2)} and start a fresh till?
                  </Text>
                  {carry && carry.count > 0 && (
                    <Text style={styles.amberText}>
                      €{status.today.total.toFixed(2)} today + €{carry.total.toFixed(2)} carried over = €
                      {status.total.toFixed(2)}
                    </Text>
                  )}
                </View>
              )}
              {isEmpty && <Text style={styles.emptyText}>No cash taken yet this shift.</Text>}
            </>
          )}

          {phase === 'closed' && closeResult && (
            <View style={styles.greenCard}>
              <Text style={{ fontSize: 40 }}>✅</Text>
              <Text style={styles.greenTitle}>Till closed</Text>
              <Text style={styles.greenSub}>
                €{closeResult.total.toFixed(2)} handed over · {closeResult.count} sales
              </Text>
              {!!closeResult.carryOverAmount && closeResult.carryOverAmount > 0 && (
                <Text style={styles.greenSub}>
                  (€{closeResult.carryOverAmount.toFixed(2)} from previous days)
                </Text>
              )}
            </View>
          )}

          {/* Footer */}
          {phase === 'ready' && !isEmpty && (
            <Pressable style={styles.primaryBtn} onPress={() => setPhase('confirming')}>
              <Text style={styles.primaryBtnText}>Close till</Text>
            </Pressable>
          )}
          {phase === 'confirming' && (
            <View style={styles.rowGap}>
              <Pressable style={styles.grayBtn} onPress={() => setPhase('ready')}>
                <Text style={styles.grayBtnText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.primaryBtn} onPress={confirmClose}>
                <Text style={styles.primaryBtnText}>Confirm</Text>
              </Pressable>
            </View>
          )}
          {phase === 'closing' && (
            <View style={[styles.grayBtn, { opacity: 0.6 }]}>
              <ActivityIndicator color={colors.body} />
            </View>
          )}
          {(phase === 'closed' || phase === 'error' || (phase === 'ready' && isEmpty)) && (
            <Pressable
              style={[styles.grayBtn, phase === 'closed' && { backgroundColor: '#16a34a' }]}
              onPress={onClose}
            >
              <Text style={[styles.grayBtnText, phase === 'closed' && { color: '#ffffff' }]}>
                {phase === 'closed' ? 'Done' : 'Close'}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.cardBg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 34, gap: 14,
  },
  handle: {
    width: 36, height: 4, borderRadius: 999, backgroundColor: colors.borderInput, alignSelf: 'center',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 34, height: 34, borderRadius: 999, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 12, fontWeight: '600', color: '#ffffff' },
  title: { fontSize: 17, fontWeight: '600', color: colors.heading },
  closeBtn: {
    width: 32, height: 32, borderRadius: 999, backgroundColor: colors.chipBg,
    alignItems: 'center', justifyContent: 'center',
  },
  todayBlock: { alignItems: 'center', gap: 2, paddingVertical: 8 },
  todayCaption: { fontSize: 11, fontWeight: '600', letterSpacing: 1, color: colors.faint },
  todayAmount: { fontSize: 42, fontWeight: '900', color: colors.heading, fontVariant: ['tabular-nums'] },
  todaySub: { fontSize: 13, color: colors.muted },
  amberCard: {
    backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 12, padding: 13,
  },
  amberText: { fontSize: 13, color: '#b45309', lineHeight: 19, textAlign: 'center' },
  confirmTitle: { fontSize: 15, fontWeight: '600', color: '#92400e', textAlign: 'center' },
  emptyText: { fontSize: 14, color: colors.muted, textAlign: 'center', paddingVertical: 8 },
  errCard: {
    backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 12, padding: 13,
  },
  errText: { fontSize: 13, color: '#b91c1c', textAlign: 'center' },
  greenCard: {
    backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0', borderRadius: 12,
    padding: 20, alignItems: 'center', gap: 4,
  },
  greenTitle: { fontSize: 17, fontWeight: '700', color: '#15803d' },
  greenSub: { fontSize: 13, color: '#166534' },
  rowGap: { flexDirection: 'row', gap: 10 },
  primaryBtn: {
    flexGrow: 1, flexBasis: 0, height: 48, borderRadius: 10, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: { fontSize: 15, fontWeight: '600', color: '#ffffff' },
  grayBtn: {
    flexGrow: 1, flexBasis: 0, height: 48, borderRadius: 10, backgroundColor: colors.chipBg,
    alignItems: 'center', justifyContent: 'center',
  },
  grayBtnText: { fontSize: 15, fontWeight: '600', color: colors.body },
})
