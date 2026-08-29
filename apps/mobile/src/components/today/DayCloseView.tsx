/**
 * Day close — RN port of the web DayCloseView: cash-up only. Closes every
 * open till in one two-step confirm; totals come from the close-independent
 * civil-day report.
 */
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { rpc, type ActionResult } from '@/lib/api'
import { colors } from '@/theme'

interface EmployeeCashTotal { employeeId: string; name: string; active: boolean; total: number; count: number }
interface OpenTill { employeeId: string; total: number; count: number; carryOver: { total: number; count: number } }

type ClosePhase = 'idle' | 'confirming' | 'closing' | 'done'

export default function DayCloseView({
  siteId, accessKey, todayIso,
}: {
  siteId: string
  accessKey: string
  todayIso: string
}) {
  const [tills, setTills] = useState<EmployeeCashTotal[] | null>(null)
  const [openCount, setOpenCount] = useState(0)
  const [carryTotal, setCarryTotal] = useState(0)
  const [phase, setPhase] = useState<ClosePhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ closedCount: number; totalClosed: number; carryOverClosed: number } | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void (async () => {
      try {
        const [report, open] = await Promise.all([
          rpc<ActionResult & { tills?: EmployeeCashTotal[] }>('getTillDayReport', [siteId, todayIso, accessKey]),
          rpc<ActionResult & { tills?: OpenTill[] }>('getOpenTills', [siteId, accessKey]),
        ])
        if (report.status === 'ok' && report.tills) setTills(report.tills)
        else setError(report.errors?.[0] ?? 'Something went wrong.')
        if (open.status === 'ok' && open.tills) {
          const withBalance = open.tills.filter(t => t.total > 0 || t.count > 0)
          setOpenCount(withBalance.length)
          setCarryTotal(open.tills.reduce((a, t) => a + (t.carryOver?.total ?? 0), 0))
        }
      } catch {
        setError('Could not reach the server.')
      }
    })()
  }, [siteId, accessKey, todayIso])

  async function confirmClose() {
    setPhase('closing')
    try {
      const res = await rpc<ActionResult & { closedCount?: number; totalClosed?: number; carryOverClosed?: number }>(
        'closeDay', [siteId, accessKey],
      )
      if (res.status === 'ok') {
        setResult({
          closedCount: res.closedCount ?? 0,
          totalClosed: res.totalClosed ?? 0,
          carryOverClosed: res.carryOverClosed ?? 0,
        })
        setPhase('done')
        setOpenCount(0)
        setCarryTotal(0)
      } else {
        setError(res.errors?.[0] ?? 'Something went wrong.')
        setPhase('idle')
      }
    } catch {
      setError('Could not reach the server.')
      setPhase('idle')
    }
  }

  const total = (tills ?? []).reduce((a, t) => a + t.total, 0)
  const count = (tills ?? []).reduce((a, t) => a + t.count, 0)
  const dateLabel = new Date(`${todayIso}T12:00:00.000Z`).toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  if (tills === null && !error) {
    return <ActivityIndicator color={colors.accent} style={{ marginVertical: 40 }} />
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.dateLine}>Today, {dateLabel}</Text>
      <View style={styles.totalsCard}>
        <View style={styles.totalsHalf}>
          <Text style={styles.totalsLabel}>Total cash</Text>
          <Text style={styles.totalsValue}>€{total.toFixed(2)}</Text>
        </View>
        <View style={styles.totalsDivider} />
        <View style={styles.totalsHalf}>
          <Text style={styles.totalsLabel}>Sales</Text>
          <Text style={styles.totalsValue}>{count}</Text>
        </View>
      </View>

      <Text style={styles.sectionHead}>Breakdown by employee</Text>
      <View style={styles.breakdown}>
        {(tills ?? []).length === 0 ? (
          <Text style={styles.emptyText}>No cash recorded for today.</Text>
        ) : (
          (tills ?? []).map(t => (
            <View key={t.employeeId} style={styles.row}>
              <Text style={styles.rowName}>
                {t.name}
                {!t.active && <Text style={styles.inactive}> (inactive)</Text>}
              </Text>
              <Text style={styles.rowSub}>{t.count} cash sales</Text>
              <Text style={[styles.rowAmount, t.total === 0 && { color: colors.borderInput }]}>
                €{t.total.toFixed(2)}
              </Text>
            </View>
          ))
        )}
      </View>

      {error && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {phase !== 'done' && openCount > 0 && (
        <View style={styles.noteAmber}>
          <Text style={styles.noteAmberText}>
            Confirm will close {openCount} open till{openCount > 1 ? 's' : ''}.
            {carryTotal > 0 && ` €${carryTotal.toFixed(2)} of that is carried over from previous days.`}
          </Text>
        </View>
      )}

      {phase === 'done' && result ? (
        <View style={styles.doneCard}>
          <Text style={{ fontSize: 36 }}>✅</Text>
          <Text style={styles.doneTitle}>Day closed</Text>
          <Text style={styles.doneSub}>€{result.totalClosed.toFixed(2)} counted</Text>
          <Text style={styles.doneSub}>
            {result.closedCount} till{result.closedCount === 1 ? '' : 's'} closed
          </Text>
          {result.carryOverClosed > 0 && (
            <Text style={styles.doneSub}>(€{result.carryOverClosed.toFixed(2)} from previous days)</Text>
          )}
        </View>
      ) : phase === 'confirming' ? (
        <View style={{ gap: 8 }}>
          <Text style={styles.confirmText}>Close all open tills?</Text>
          <View style={styles.rowGap8}>
            <Pressable style={styles.grayBtn} onPress={() => setPhase('idle')}>
              <Text style={styles.grayBtnText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.accentBtn} onPress={() => void confirmClose()}>
              <Text style={styles.accentBtnText}>Confirm</Text>
            </Pressable>
          </View>
        </View>
      ) : phase === 'closing' ? (
        <View style={[styles.grayBtn, { opacity: 0.6 }]}>
          <ActivityIndicator color={colors.body} />
        </View>
      ) : (
        <Pressable style={styles.accentBtn} onPress={() => setPhase('confirming')}>
          <Text style={styles.accentBtnText}>Confirm day close</Text>
        </Pressable>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: { padding: 14, gap: 12 },
  dateLine: { fontSize: 13, color: colors.muted },
  totalsCard: {
    flexDirection: 'row', backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border,
    borderRadius: 14, padding: 16,
  },
  totalsHalf: { flexGrow: 1, flexBasis: 0, alignItems: 'center', gap: 2 },
  totalsDivider: { width: 1, backgroundColor: colors.border },
  totalsLabel: { fontSize: 12, color: colors.muted },
  totalsValue: { fontSize: 26, fontWeight: '900', color: colors.heading, fontVariant: ['tabular-nums'] },
  sectionHead: { fontSize: 13, fontWeight: '600', color: colors.body },
  breakdown: {
    backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, paddingHorizontal: 13,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  rowName: { fontSize: 14, fontWeight: '600', color: colors.heading, flexGrow: 1 },
  inactive: { fontSize: 12, fontWeight: '400', color: colors.faint },
  rowSub: { fontSize: 12, color: colors.muted },
  rowAmount: { fontSize: 15, fontWeight: '800', color: colors.heading, fontVariant: ['tabular-nums'] },
  emptyText: { fontSize: 13, color: colors.muted, paddingVertical: 14, textAlign: 'center' },
  errorCard: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 10, padding: 12 },
  errorText: { fontSize: 13, color: '#b91c1c' },
  noteAmber: { backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 10, padding: 11 },
  noteAmberText: { fontSize: 12, color: '#b45309', lineHeight: 17 },
  confirmText: { fontSize: 14, fontWeight: '600', color: '#92400e', textAlign: 'center' },
  rowGap8: { flexDirection: 'row', gap: 8 },
  accentBtn: {
    height: 48, borderRadius: 10, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center', flexGrow: 1,
  },
  accentBtnText: { fontSize: 15, fontWeight: '600', color: '#ffffff' },
  grayBtn: {
    height: 48, borderRadius: 10, backgroundColor: colors.chipBg,
    alignItems: 'center', justifyContent: 'center', flexGrow: 1,
  },
  grayBtnText: { fontSize: 15, fontWeight: '600', color: colors.body },
  doneCard: {
    backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0', borderRadius: 12,
    padding: 20, alignItems: 'center', gap: 4,
  },
  doneTitle: { fontSize: 17, fontWeight: '700', color: '#15803d' },
  doneSub: { fontSize: 13, color: '#166534' },
})
