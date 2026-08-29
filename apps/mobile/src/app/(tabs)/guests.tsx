/**
 * Guests tab — RN port of the web GuestSearchSheet (host stand): expected
 * today by default, 250 ms debounced search over [today, +90d], status-pill
 * precedence Upcoming → Paid → Hold → Seated, and locate → Beds tab.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { RESERVATION_COMPLETE, RESERVATION_HELD } from '@repo/data/reservation-status'
import { rpc, type ActionResult } from '@/lib/api'
import { useGridStore } from '@/lib/grid-store'
import { requestLocate } from '@/lib/locate'
import { colors } from '@/theme'

interface ReservationMatch {
  id: string
  status: string
  operationalStatus: string
  from: string
  to: string
  guestName: string | null
  guestContact: string | null
  internalNotes: string | null
  paymentRef: string | null
  partySize: number
  items: { id: string; number: number; seatLabel: string | null }[]
  userEmail: string | null
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

function pill(r: ReservationMatch): { label: string; bg: string; fg: string } {
  const today = dayStart(new Date())
  const from = dayStart(new Date(r.from))
  const overlapsToday = from <= today && new Date(r.to) >= today
  if (!overlapsToday && from > today) {
    const label = `Upcoming · ${from.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`
    return { label, bg: '#f3f4f6', fg: '#4b5563' }
  }
  if (r.status === RESERVATION_COMPLETE && r.operationalStatus === 'expected')
    return { label: 'Paid', bg: '#dcfce7', fg: '#15803d' }
  if (r.status === RESERVATION_HELD) return { label: 'Hold', bg: '#fef9c3', fg: '#a16207' }
  return { label: 'Seated', bg: '#dbeafe', fg: '#1d4ed8' }
}

function dateLabel(r: ReservationMatch): string {
  const from = new Date(r.from)
  const to = new Date(r.to)
  const days = Math.max(1, Math.round((dayStart(to).getTime() - dayStart(from).getTime()) / 86_400_000) + 1)
  const fmt = (d: Date, weekday: boolean) =>
    d.toLocaleDateString(undefined, weekday ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' })
  const label = days === 1 ? fmt(from, true) : `${fmt(from, false)} – ${fmt(to, false)}`
  return `${label} · ${days}d`
}

export default function Guests() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { pairing, grid } = useGridStore()
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ReservationMatch[] | null>(null)
  const [stale, setStale] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const seqRef = useRef(0)

  const fetchRows = useCallback(
    async (q: string) => {
      if (!pairing) return
      const seq = ++seqRef.current
      setStale(true)
      try {
        const res = await rpc<ActionResult & { reservations?: ReservationMatch[] }>('findReservations', [
          pairing.siteId, q || undefined, pairing.accessKey,
        ])
        if (seq !== seqRef.current) return
        if (res.status === 'ok' && Array.isArray(res.reservations)) {
          setRows(res.reservations)
          setFetchError(false)
        } else {
          setFetchError(true)
        }
      } catch {
        if (seq === seqRef.current) setFetchError(true)
      } finally {
        if (seq === seqRef.current) setStale(false)
      }
    },
    [pairing],
  )

  useEffect(() => {
    if (!pairing) return
    const delay = query ? 250 : 0
    const t = setTimeout(() => void fetchRows(query), delay)
    return () => clearTimeout(t)
  }, [query, pairing, fetchRows])

  const locate = (r: ReservationMatch) => {
    const first = r.items[0]
    if (!first) return
    const gridItem = grid?.site.inventoryItems.find(i => i.id === first.id)
    if (!gridItem) return
    requestLocate(gridItem.id)
    router.navigate('/(tabs)/beds')
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Guests</Text>
        <TextInput
          style={styles.search}
          placeholder="Search name, phone or seat…"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          value={query}
          onChangeText={setQuery}
        />
      </View>
      {rows === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : fetchError ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>Could not load guests</Text>
          <Pressable style={styles.retryBtn} onPress={() => void fetchRows(query)}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={r => r.id}
          style={stale ? { opacity: 0.5 } : undefined}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            !query ? <Text style={styles.caption}>EXPECTED TODAY</Text> : null
          }
          ListEmptyComponent={
            <Text style={styles.empty}>{query ? 'No bookings match' : 'No one expected yet'}</Text>
          }
          renderItem={({ item: r }) => {
            const p = pill(r)
            const beds = r.items.map(i => i.seatLabel || String(i.number)).join(', ')
            return (
              <Pressable style={styles.row} onPress={() => locate(r)}>
                <View style={{ flexShrink: 1, flexGrow: 1, gap: 3 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {r.guestName || r.userEmail || 'Guest'}
                    {r.partySize > 1 && <Text style={styles.party}>  +{r.partySize - 1}</Text>}
                  </Text>
                  <Text style={styles.sub} numberOfLines={1}>
                    Seats {beds}
                    {r.internalNotes ? ` · ${r.internalNotes}` : ''}
                  </Text>
                  <Text style={styles.sub}>{dateLabel(r)}</Text>
                </View>
                <View style={[styles.pill, { backgroundColor: p.bg }]}>
                  <Text style={[styles.pillText, { color: p.fg }]}>{p.label}</Text>
                </View>
              </Pressable>
            )
          }}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.pageBg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  header: {
    backgroundColor: colors.cardBg, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: colors.chipBg, gap: 10,
  },
  title: { fontSize: 17, fontWeight: '600', color: colors.heading },
  search: {
    borderWidth: 1, borderColor: colors.borderInput, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.heading,
  },
  listContent: { padding: 12, gap: 8 },
  caption: { fontSize: 11, fontWeight: '600', letterSpacing: 1, color: colors.faint, marginBottom: 4 },
  empty: { fontSize: 14, color: colors.muted, textAlign: 'center', paddingVertical: 40 },
  errorText: { fontSize: 14, color: colors.danger },
  retryBtn: {
    paddingHorizontal: 18, paddingVertical: 9, borderRadius: 8,
    backgroundColor: colors.chipBg,
  },
  retryText: { fontSize: 14, fontWeight: '600', color: colors.body },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, padding: 13,
  },
  name: { fontSize: 15, fontWeight: '600', color: colors.heading },
  party: { fontSize: 13, fontWeight: '400', color: colors.muted },
  sub: { fontSize: 12, color: colors.muted },
  pill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: 11, fontWeight: '600' },
})
