/**
 * Daily summary — RN port of the web DailySummaryView: Open tills (itemized
 * per-employee, close-till) and Day report (read-only, both channels).
 * Totals contract: the header uses the close-independent civil-day report so
 * closing a till never moves it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native'
import { rpc, type ActionResult } from '@/lib/api'
import { colors } from '@/theme'

interface Bucket { total: number; count: number }
interface OpenTillItem {
  id: string
  kind: 'sunbed' | 'rental'
  label: string
  seats: number
  amount: number
  at: string
  carryOver: boolean
}
interface EmployeeOpenTill {
  employeeId: string
  name: string
  active: boolean
  total: number
  count: number
  today: Bucket
  carryOver: Bucket & { oldestAt?: string | null }
  items: OpenTillItem[]
}
interface EmployeeCashTotal { employeeId: string; name: string; active: boolean; total: number; count: number }
interface EmployeeShiftItem { reservationId: string; seats: string[]; amount: number; at: string; channel: 'cash' | 'card' }
interface EmployeeShift { employeeId: string; name: string; active: boolean; total: number; count: number; items: EmployeeShiftItem[] }

const fmtWhen = (at: string, todayIso: string) => {
  const d = new Date(at)
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const sameDay = d.toISOString().slice(0, 10) === todayIso
  return sameDay ? time : `${d.getDate()}.${d.getMonth() + 1} ${time}`
}
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

export default function SummaryView({
  siteId, accessKey, todayIso,
}: {
  siteId: string
  accessKey: string
  todayIso: string
}) {
  const [mode, setMode] = useState<'open' | 'day'>('open')
  const [tills, setTills] = useState<EmployeeOpenTill[] | null>(null)
  const [dayReport, setDayReport] = useState<EmployeeCashTotal[]>([])
  const [shifts, setShifts] = useState<EmployeeShift[] | null>(null)
  const [dayIso, setDayIso] = useState(todayIso)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [closing, setClosing] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [closed, setClosed] = useState<Record<string, { total: number; count: number }>>({})
  const [error, setError] = useState<string | null>(null)
  const startedRef = useRef(false)

  const loadOpen = useCallback(async () => {
    try {
      const [open, report] = await Promise.all([
        rpc<ActionResult & { tills?: EmployeeOpenTill[] }>('getOpenTillItems', [siteId, accessKey]),
        rpc<ActionResult & { tills?: EmployeeCashTotal[] }>('getTillDayReport', [siteId, todayIso, accessKey]),
      ])
      if (open.status === 'ok' && open.tills) {
        setTills(open.tills)
        setError(null)
      } else {
        setError(open.errors?.[0] ?? 'Something went wrong.')
      }
      if (report.status === 'ok' && report.tills) setDayReport(report.tills)
    } catch {
      setError('Could not reach the server.')
    }
  }, [siteId, accessKey, todayIso])

  const loadDay = useCallback(
    async (iso: string) => {
      setShifts(null)
      try {
        const res = await rpc<ActionResult & { shifts?: EmployeeShift[] }>('getDayShiftItems', [siteId, iso, accessKey])
        if (res.status === 'ok' && res.shifts) setShifts(res.shifts)
        else setError(res.errors?.[0] ?? 'Something went wrong.')
      } catch {
        setError('Could not reach the server.')
      }
    },
    [siteId, accessKey],
  )

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void loadOpen()
  }, [loadOpen])

  useEffect(() => {
    if (mode === 'day') void loadDay(dayIso)
  }, [mode, dayIso, loadDay])

  async function closeTill(employeeId: string) {
    setClosing(employeeId)
    setConfirming(null)
    try {
      const res = await rpc<ActionResult & { total?: number; count?: number }>('closeTill', [siteId, employeeId, accessKey])
      if (res.status === 'ok') {
        setClosed(c => ({ ...c, [employeeId]: { total: res.total ?? 0, count: res.count ?? 0 } }))
        void loadOpen()
      } else {
        setError(res.errors?.[0] ?? 'Something went wrong.')
      }
    } catch {
      setError('Could not reach the server.')
    } finally {
      setClosing(null)
    }
  }

  const grandTotal =
    mode === 'open'
      ? dayReport.reduce((a, t) => a + t.total, 0)
      : (shifts ?? []).reduce((a, s) => a + s.total, 0)
  const grandCount =
    mode === 'open'
      ? dayReport.reduce((a, t) => a + t.count, 0)
      : (shifts ?? []).reduce((a, s) => a + s.items.reduce((x, i) => x + i.seats.length, 0), 0)
  const uncounted = (tills ?? []).reduce((a, t) => a + t.today.total, 0)
  const carryTotal = (tills ?? []).reduce((a, t) => a + t.carryOver.total, 0)
  const allZero = tills !== null && !tills.some(t => t.total > 0 || t.count > 0)

  const step = (days: number) => {
    const next = new Date(new Date(`${dayIso}T12:00:00Z`).getTime() + days * 86_400_000)
      .toISOString()
      .slice(0, 10)
    if (next <= todayIso) setDayIso(next)
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.totalsCard}>
        <View style={styles.totalsHalf}>
          <Text style={styles.totalsLabel}>{mode === 'open' ? "Today's cash" : 'Total earnings'}</Text>
          <Text style={styles.totalsValue}>€{grandTotal.toFixed(2)}</Text>
        </View>
        <View style={styles.totalsDivider} />
        <View style={styles.totalsHalf}>
          <Text style={styles.totalsLabel}>{mode === 'open' ? 'Sales' : 'Sunbeds'}</Text>
          <Text style={styles.totalsValue}>{grandCount}</Text>
        </View>
      </View>
      {mode === 'open' && (
        <View style={{ gap: 2 }}>
          {uncounted > 0 && <Text style={styles.reconcile}>Still uncounted: €{uncounted.toFixed(2)}</Text>}
          {grandTotal - uncounted > 0 && (
            <Text style={styles.reconcile}>Handed in today: €{Math.max(0, grandTotal - uncounted).toFixed(2)}</Text>
          )}
          {carryTotal > 0 && (
            <Text style={[styles.reconcile, { color: '#b45309' }]}>
              + €{carryTotal.toFixed(2)} carried over from previous days
            </Text>
          )}
        </View>
      )}

      <View style={styles.modeTabs}>
        {(
          [
            ['open', 'Open tills'],
            ['day', 'Day report'],
          ] as ['open' | 'day', string][]
        ).map(([key, label]) => (
          <Pressable key={key} style={styles.modeTab} onPress={() => setMode(key)}>
            <Text style={[styles.modeTabText, mode === key && styles.modeTabTextActive]}>{label}</Text>
            {mode === key && <View style={styles.modeTabUnderline} />}
          </Pressable>
        ))}
      </View>

      {error && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {mode === 'open' ? (
        tills === null ? (
          <ActivityIndicator color={colors.accent} style={{ marginVertical: 24 }} />
        ) : allZero ? (
          <View style={styles.emptyBlock}>
            <Text style={styles.emptyTitle}>All tills are clear</Text>
            <Text style={styles.emptySub}>No open cash on any till right now.</Text>
          </View>
        ) : (
          <>
            <View style={styles.noteAmber}>
              <Text style={styles.noteAmberText}>
                Closing sweeps in all uncounted cash since each worker&#8217;s last close — including prior days.
              </Text>
            </View>
            {tills.map(till => {
              const done = closed[till.employeeId]
              const hasBalance = till.total > 0 || till.count > 0
              const todaySeats = till.items.filter(i => !i.carryOver).reduce((a, i) => a + i.seats, 0)
              return (
                <View
                  key={till.employeeId}
                  style={[
                    styles.tillCard,
                    done && { borderColor: '#bbf7d0', backgroundColor: '#f0fdf4' },
                    !done && !hasBalance && { opacity: 0.55 },
                  ]}
                >
                  <View style={styles.tillHeader}>
                    <View style={{ flexGrow: 1 }}>
                      <Text style={styles.tillName}>
                        {till.name}
                        {!till.active && <Text style={styles.inactive}> (inactive)</Text>}
                      </Text>
                      <Text style={styles.tillSub}>
                        {till.today.count} cash sales ({todaySeats} sunbeds)
                      </Text>
                      {till.carryOver.count > 0 && !done && (
                        <View style={styles.carryChip}>
                          <Text style={styles.carryChipText}>
                            + €{till.carryOver.total.toFixed(2)} from{' '}
                            {till.carryOver.oldestAt ? shortDate(till.carryOver.oldestAt) : 'earlier'}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.tillAmount, !hasBalance && { color: colors.borderInput }]}>
                      {done ? '✓' : `€${till.today.total.toFixed(2)}`}
                    </Text>
                  </View>
                  {done ? (
                    <Text style={styles.closedText}>
                      €{done.total.toFixed(2)} handed over · {done.count} sales
                    </Text>
                  ) : (
                    <>
                      {till.items.length > 0 && (
                        <View style={styles.itemList}>
                          {till.items.slice(0, 20).map(item => (
                            <View key={item.id} style={styles.itemRow}>
                              {item.carryOver && <View style={styles.carryDot} />}
                              <Text style={styles.itemLabel} numberOfLines={1}>
                                {item.label}
                              </Text>
                              <Text style={styles.itemWhen}>{fmtWhen(item.at, todayIso)}</Text>
                              {item.kind === 'rental' && (
                                <View style={styles.rentalPill}>
                                  <Text style={styles.rentalPillText}>Rental</Text>
                                </View>
                              )}
                              <Text style={styles.itemAmount}>€{item.amount.toFixed(2)}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                      {hasBalance &&
                        (confirming === till.employeeId ? (
                          <View style={{ gap: 8 }}>
                            <Text style={styles.confirmText}>
                              Close {till.name}&#8217;s till and hand over €{till.total.toFixed(2)}?
                            </Text>
                            <View style={styles.rowGap8}>
                              <Pressable style={styles.grayBtn} onPress={() => setConfirming(null)}>
                                <Text style={styles.grayBtnText}>Cancel</Text>
                              </Pressable>
                              <Pressable style={styles.accentBtn} onPress={() => void closeTill(till.employeeId)}>
                                <Text style={styles.accentBtnText}>Confirm</Text>
                              </Pressable>
                            </View>
                          </View>
                        ) : closing === till.employeeId ? (
                          <View style={[styles.grayBtn, { opacity: 0.6 }]}>
                            <ActivityIndicator color={colors.body} />
                          </View>
                        ) : (
                          <Pressable style={styles.accentBtn} onPress={() => setConfirming(till.employeeId)}>
                            <Text style={styles.accentBtnText}>Close till</Text>
                          </Pressable>
                        ))}
                    </>
                  )}
                </View>
              )
            })}
          </>
        )
      ) : (
        <>
          <View style={styles.dayPicker}>
            <Pressable style={styles.stepBtn} onPress={() => step(-1)}>
              <Text style={styles.stepBtnText}>−</Text>
            </Pressable>
            <Text style={styles.dayLabel}>
              {new Date(`${dayIso}T12:00:00Z`).toLocaleDateString(undefined, {
                weekday: 'short', day: 'numeric', month: 'short',
              })}
            </Text>
            <Pressable style={[styles.stepBtn, dayIso >= todayIso && { opacity: 0.35 }]} onPress={() => step(1)}>
              <Text style={styles.stepBtnText}>+</Text>
            </Pressable>
          </View>
          <View style={styles.noteBlue}>
            <Text style={styles.noteBlueText}>
              Day report is read-only history. To close a till, switch to Open tills.
            </Text>
          </View>
          {shifts === null ? (
            <ActivityIndicator color={colors.accent} style={{ marginVertical: 24 }} />
          ) : shifts.length === 0 ? (
            <Text style={styles.emptySub}>No earnings recorded for this day.</Text>
          ) : (
            shifts.map(shift => {
              const seats = shift.items.reduce((a, i) => a + i.seats.length, 0)
              const open = expanded === shift.employeeId
              return (
                <View key={shift.employeeId} style={styles.tillCard}>
                  <Pressable
                    style={styles.tillHeader}
                    onPress={() => setExpanded(open ? null : shift.employeeId)}
                  >
                    <View style={{ flexGrow: 1 }}>
                      <Text style={styles.tillName}>
                        {shift.name}
                        {!shift.active && <Text style={styles.inactive}> (inactive)</Text>}
                      </Text>
                      <Text style={styles.tillSub}>
                        {shift.count} sales ({seats} sunbeds)
                      </Text>
                    </View>
                    <Text style={styles.tillAmount}>€{shift.total.toFixed(2)}</Text>
                    <Text style={styles.chevron}>{open ? '▴' : '▾'}</Text>
                  </Pressable>
                  {open && (
                    <View style={styles.itemList}>
                      {shift.items.length === 0 ? (
                        <Text style={styles.emptySub}>No sunbeds recorded</Text>
                      ) : (
                        shift.items.map(item => (
                          <View key={`${item.reservationId}-${item.at}`} style={styles.itemRow}>
                            <Text style={styles.itemLabel} numberOfLines={1}>
                              {item.seats.join(', ')}
                            </Text>
                            <Text style={styles.itemWhen}>{fmtWhen(item.at, todayIso)}</Text>
                            <View
                              style={[
                                styles.rentalPill,
                                { backgroundColor: item.channel === 'cash' ? '#dcfce7' : '#dbeafe' },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.rentalPillText,
                                  { color: item.channel === 'cash' ? '#15803d' : '#1d4ed8' },
                                ]}
                              >
                                {item.channel === 'cash' ? 'Cash' : 'Card'}
                              </Text>
                            </View>
                            <Text style={styles.itemAmount}>€{item.amount.toFixed(2)}</Text>
                          </View>
                        ))
                      )}
                    </View>
                  )}
                </View>
              )
            })
          )}
        </>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: { padding: 14, gap: 12 },
  totalsCard: {
    flexDirection: 'row', backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border,
    borderRadius: 14, padding: 16,
  },
  totalsHalf: { flexGrow: 1, flexBasis: 0, alignItems: 'center', gap: 2 },
  totalsDivider: { width: 1, backgroundColor: colors.border },
  totalsLabel: { fontSize: 12, color: colors.muted },
  totalsValue: { fontSize: 26, fontWeight: '900', color: colors.heading, fontVariant: ['tabular-nums'] },
  reconcile: { fontSize: 12, color: colors.muted, textAlign: 'center' },
  modeTabs: { flexDirection: 'row', gap: 18, borderBottomWidth: 1, borderBottomColor: colors.border },
  modeTab: { paddingVertical: 8, alignItems: 'center' },
  modeTabText: { fontSize: 14, fontWeight: '500', color: colors.muted },
  modeTabTextActive: { color: colors.heading, fontWeight: '700' },
  modeTabUnderline: { height: 2, alignSelf: 'stretch', backgroundColor: colors.accent, marginTop: 6, marginBottom: -1 },
  errorCard: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 10, padding: 12 },
  errorText: { fontSize: 13, color: '#b91c1c' },
  emptyBlock: { alignItems: 'center', paddingVertical: 32, gap: 4 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.heading },
  emptySub: { fontSize: 13, color: colors.muted, textAlign: 'center' },
  noteAmber: { backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 10, padding: 11 },
  noteAmberText: { fontSize: 12, color: '#b45309', lineHeight: 17 },
  noteBlue: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 10, padding: 11 },
  noteBlueText: { fontSize: 12, color: '#1d4ed8', lineHeight: 17 },
  tillCard: {
    backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, padding: 13, gap: 10,
  },
  tillHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tillName: { fontSize: 15, fontWeight: '800', color: colors.heading },
  inactive: { fontSize: 12, fontWeight: '400', color: colors.faint },
  tillSub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  tillAmount: { fontSize: 19, fontWeight: '900', color: colors.heading, fontVariant: ['tabular-nums'] },
  chevron: { fontSize: 12, color: colors.faint },
  carryChip: {
    alignSelf: 'flex-start', backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a',
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4,
  },
  carryChipText: { fontSize: 11, color: '#b45309' },
  closedText: { fontSize: 13, color: '#15803d' },
  itemList: { gap: 6, maxHeight: 180 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  carryDot: { width: 5, height: 5, borderRadius: 999, backgroundColor: '#f59e0b' },
  itemLabel: { fontSize: 12, color: colors.body, flexShrink: 1, flexGrow: 1 },
  itemWhen: { fontSize: 11, color: colors.faint, fontVariant: ['tabular-nums'] },
  rentalPill: { backgroundColor: '#fef3c7', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  rentalPillText: { fontSize: 10, fontWeight: '600', color: '#b45309' },
  itemAmount: { fontSize: 12, fontWeight: '600', color: colors.heading, fontVariant: ['tabular-nums'] },
  confirmText: { fontSize: 13, color: '#92400e', textAlign: 'center' },
  rowGap8: { flexDirection: 'row', gap: 8 },
  accentBtn: {
    flexGrow: 1, height: 44, borderRadius: 10, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  accentBtnText: { fontSize: 14, fontWeight: '600', color: '#ffffff' },
  grayBtn: {
    flexGrow: 1, height: 44, borderRadius: 10, backgroundColor: colors.chipBg,
    alignItems: 'center', justifyContent: 'center',
  },
  grayBtnText: { fontSize: 14, fontWeight: '600', color: colors.body },
  dayPicker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  stepBtn: {
    width: 40, height: 40, borderRadius: 10, borderWidth: 1, borderColor: colors.borderInput,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cardBg,
  },
  stepBtnText: { fontSize: 17, color: colors.body },
  dayLabel: { fontSize: 15, fontWeight: '700', color: colors.heading, minWidth: 130, textAlign: 'center' },
})
