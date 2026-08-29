/**
 * Trends — RN port of the web TrendsView: 7d/30d/1y windows, three metrics,
 * KPI tiles, a stacked channel chart, and the daily breakdown. Charts are
 * plain Views (no chart lib): bars scale against the window's max.
 * CSV export waits for the share-sheet pass (W9).
 */
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { rpc, type ActionResult } from '@/lib/api'
import { colors } from '@/theme'

interface RevenueRow { date: string; cash: number; qr: number; online: number; total: number }
interface OccupancyRow { date: string; occupied: number; occupancyPct: number }
interface OpsRow { date: string; rentedSeats: number; revenue: number }
interface Trends {
  revenue: { rows: RevenueRow[]; summary: { total: number; bestDay: RevenueRow | null } }
  occupancy: { rows: OccupancyRow[]; summary: { avgOccupancyPct: number } }
  operations: { rows: OpsRow[] }
}

type Metric = 'revenue' | 'occupancy' | 'sunbeds'
const CHANNEL_COLORS = { cash: '#16a34a', qr: '#2563eb', online: '#111827' } as const
const CHART_H = 130

const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

export default function TrendsView({ siteId, accessKey }: { siteId: string; accessKey: string }) {
  const [days, setDays] = useState(30)
  const [metric, setMetric] = useState<Metric>('revenue')
  const [data, setData] = useState<Trends | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (d: number) => {
      setData(null)
      setError(null)
      try {
        const res = await rpc<ActionResult & Partial<Trends>>('getManageTrends', [siteId, d, accessKey])
        if (res.status === 'ok' && res.revenue && res.occupancy && res.operations) {
          setData(res as unknown as Trends)
        } else {
          setError(res.errors?.[0] ?? 'Failed to load trends')
        }
      } catch {
        setError('Could not reach the server.')
      }
    },
    [siteId, accessKey],
  )

  useEffect(() => {
    void load(days)
  }, [days, load])

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    )
  }
  if (!data) {
    return <ActivityIndicator color={colors.accent} style={{ marginVertical: 40 }} />
  }

  const revRows = data.revenue.rows
  const occRows = data.occupancy.rows
  const isEmpty =
    metric === 'revenue'
      ? data.revenue.summary.total === 0
      : metric === 'occupancy'
        ? occRows.every(r => r.occupancyPct === 0)
        : occRows.every(r => r.occupied === 0)

  const seatsByDate = new Map(data.operations.rows.map(r => [r.date, r.rentedSeats]))

  // KPI tiles
  let kpi1 = { label: '', value: '' }
  let kpi2 = { label: 'Best day', value: '—', date: '' }
  if (metric === 'revenue') {
    kpi1 = { label: 'Revenue', value: `€${data.revenue.summary.total.toFixed(2)}` }
    const best = data.revenue.summary.bestDay
    if (best) kpi2 = { label: 'Best day', value: `€${best.total.toFixed(2)}`, date: shortDate(best.date) }
  } else if (metric === 'occupancy') {
    kpi1 = { label: 'Avg occupancy', value: `${data.occupancy.summary.avgOccupancyPct}%` }
    const peak = occRows.reduce<OccupancyRow | null>((a, r) => (!a || r.occupancyPct > a.occupancyPct ? r : a), null)
    if (peak && peak.occupancyPct > 0)
      kpi2 = { label: 'Best day', value: `${Math.round(peak.occupancyPct)}%`, date: shortDate(peak.date) }
  } else {
    const avg = occRows.length ? Math.round(occRows.reduce((a, r) => a + r.occupied, 0) / occRows.length) : 0
    kpi1 = { label: 'Avg sunbeds', value: String(avg) }
    const peak = occRows.reduce<OccupancyRow | null>((a, r) => (!a || r.occupied > a.occupied ? r : a), null)
    if (peak && peak.occupied > 0) kpi2 = { label: 'Best day', value: String(peak.occupied), date: shortDate(peak.date) }
  }

  const chartRows =
    metric === 'revenue'
      ? revRows.map(r => ({ date: r.date, parts: [r.cash, r.qr, r.online], total: r.total }))
      : metric === 'occupancy'
        ? occRows.map(r => ({ date: r.date, parts: [r.occupancyPct], total: r.occupancyPct }))
        : occRows.map(r => ({ date: r.date, parts: [r.occupied], total: r.occupied }))
  const maxTotal = Math.max(1, ...chartRows.map(r => r.total))

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.pillRow}>
        {[7, 30, 365].map(d => (
          <Pressable key={d} style={[styles.pill, days === d && styles.pillActive]} onPress={() => setDays(d)}>
            <Text style={[styles.pillText, days === d && styles.pillTextActive]}>
              {d === 365 ? '1y' : `${d}d`}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.pillRow}>
        {(
          [
            ['revenue', 'Revenue'],
            ['occupancy', 'Occupancy'],
            ['sunbeds', 'Sunbeds'],
          ] as [Metric, string][]
        ).map(([key, label]) => (
          <Pressable key={key} style={[styles.pill, metric === key && styles.pillActive]} onPress={() => setMetric(key)}>
            <Text style={[styles.pillText, metric === key && styles.pillTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {isEmpty ? (
        <Text style={styles.emptyText}>No data in this window yet</Text>
      ) : (
        <>
          <View style={styles.kpiRow}>
            <View style={styles.kpiTile}>
              <Text style={styles.kpiLabel}>{kpi1.label}</Text>
              <Text style={styles.kpiValue}>{kpi1.value}</Text>
            </View>
            <View style={styles.kpiTile}>
              <Text style={styles.kpiLabel}>{kpi2.label}</Text>
              <Text style={styles.kpiValue}>{kpi2.value}</Text>
              {!!kpi2.date && <Text style={styles.kpiDate}>{kpi2.date}</Text>}
            </View>
          </View>

          {metric === 'revenue' && (
            <View style={styles.legendRow}>
              {(
                [
                  ['Cash', CHANNEL_COLORS.cash],
                  ['QR', CHANNEL_COLORS.qr],
                  ['Online', CHANNEL_COLORS.online],
                ] as [string, string][]
              ).map(([label, color]) => (
                <View key={label} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: color }]} />
                  <Text style={styles.legendText}>{label}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.chartCard}>
            <View style={styles.chart}>
              {chartRows.map(row => (
                <View key={row.date} style={styles.barSlot}>
                  <View style={styles.barStack}>
                    {row.parts.map((v, i) => {
                      const h = Math.round((v / maxTotal) * CHART_H)
                      if (h <= 0) return null
                      const color =
                        metric === 'revenue'
                          ? [CHANNEL_COLORS.cash, CHANNEL_COLORS.qr, CHANNEL_COLORS.online][i]!
                          : '#111827'
                      return <View key={i} style={{ height: h, backgroundColor: color }} />
                    })}
                  </View>
                </View>
              ))}
            </View>
            <View style={styles.chartAxis}>
              <Text style={styles.axisText}>{shortDate(chartRows[0]!.date)}</Text>
              <Text style={styles.axisText}>{shortDate(chartRows[chartRows.length - 1]!.date)}</Text>
            </View>
          </View>

          {metric === 'revenue' && (
            <View style={styles.breakdownCard}>
              <Text style={styles.breakdownTitle}>Daily breakdown</Text>
              {[...revRows]
                .reverse()
                .filter(r => r.total > 0)
                .slice(0, 31)
                .map(r => {
                  const seats = seatsByDate.get(r.date) ?? 0
                  return (
                    <View key={r.date} style={styles.breakRow}>
                      <View style={{ flexGrow: 1 }}>
                        <Text style={styles.breakDate}>
                          {new Date(`${r.date}T12:00:00Z`).toLocaleDateString(undefined, {
                            weekday: 'short', day: 'numeric', month: 'short',
                          })}
                        </Text>
                        {seats > 0 && <Text style={styles.breakSeats}>{seats} sunbed{seats === 1 ? '' : 's'}</Text>}
                      </View>
                      <Text style={styles.breakAmount}>€{r.total.toFixed(2)}</Text>
                    </View>
                  )
                })}
            </View>
          )}
        </>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: { padding: 14, gap: 12 },
  center: { alignItems: 'center', paddingVertical: 40 },
  errorText: { fontSize: 13, color: '#b91c1c' },
  pillRow: { flexDirection: 'row', gap: 8 },
  pill: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999,
    borderWidth: 1, borderColor: colors.borderInput, backgroundColor: colors.cardBg,
  },
  pillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillText: { fontSize: 13, fontWeight: '500', color: colors.body },
  pillTextActive: { color: '#ffffff', fontWeight: '600' },
  emptyText: { fontSize: 13, color: colors.muted, textAlign: 'center', paddingVertical: 32 },
  kpiRow: { flexDirection: 'row', gap: 10 },
  kpiTile: {
    flexGrow: 1, flexBasis: 0, backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, padding: 13, gap: 2,
  },
  kpiLabel: { fontSize: 12, color: colors.muted },
  kpiValue: { fontSize: 19, fontWeight: '900', color: colors.heading, fontVariant: ['tabular-nums'] },
  kpiDate: { fontSize: 11, color: colors.faint },
  legendRow: { flexDirection: 'row', gap: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  legendText: { fontSize: 12, color: colors.muted },
  chartCard: {
    backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, padding: 12, gap: 6,
  },
  chart: { height: CHART_H, flexDirection: 'row', alignItems: 'flex-end', gap: 1 },
  barSlot: { flexGrow: 1, flexBasis: 0, alignItems: 'stretch' },
  barStack: { flexDirection: 'column-reverse', borderTopLeftRadius: 2, borderTopRightRadius: 2, overflow: 'hidden' },
  chartAxis: { flexDirection: 'row', justifyContent: 'space-between' },
  axisText: { fontSize: 10, color: colors.faint },
  breakdownCard: {
    backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, padding: 13, gap: 2,
  },
  breakdownTitle: { fontSize: 13, fontWeight: '600', color: colors.body, marginBottom: 6 },
  breakRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  breakDate: { fontSize: 13, color: colors.heading },
  breakSeats: { fontSize: 11, color: colors.faint },
  breakAmount: { fontSize: 14, fontWeight: '700', color: colors.heading, fontVariant: ['tabular-nums'] },
})
