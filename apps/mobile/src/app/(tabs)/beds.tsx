import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getBedState } from '@repo/floor-core/bed-state'
import type { InventoryItem } from '@repo/floor-core/types'
import GridCanvas from '@/components/GridCanvas'
import { getGrid, type GridPayload } from '@/lib/api'
import { buildParcelLayout, parcelNumbers } from '@/lib/grid-layout'
import { loadPairing, type Pairing } from '@/lib/pairing'
import { colors, statusTints } from '@/theme'

const POLL_MS = 30_000

/**
 * The sunbed grid — the web manage grid's core screen: live data, parcel
 * tabs, state counters, and the pan/pinch-zoom canvas (GridCanvas).
 * Bed-detail sheet, multiselect and move mode come next.
 */
export default function Beds() {
  const insets = useSafeAreaInsets()
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [grid, setGrid] = useState<GridPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [parcel, setParcel] = useState<number | null>(null)

  const fetchGrid = useCallback(async (p: Pairing) => {
    try {
      const res = await getGrid(p.siteId, p.accessKey)
      if (res.status === 'ok' && 'site' in res) {
        setGrid(res as GridPayload)
        setError(null)
      } else {
        setError(res.errors?.[0] ?? 'Could not load the grid.')
      }
    } catch {
      setError('Could not reach the server.')
    }
  }, [])

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    loadPairing().then(p => {
      if (!p) return
      setPairing(p)
      fetchGrid(p)
      timer = setInterval(() => fetchGrid(p), POLL_MS)
    })
    return () => clearInterval(timer)
  }, [fetchGrid])

  const items: InventoryItem[] = grid?.site.inventoryItems ?? []

  const parcels = useMemo(() => parcelNumbers(items), [items])
  const activeParcel = parcel ?? parcels[0] ?? null

  const layout = useMemo(
    () => (activeParcel === null ? null : buildParcelLayout(items, activeParcel)),
    [items, activeParcel],
  )

  const counters = useMemo(() => {
    const c = { occupied: 0, reserved: 0, comp: 0, free: 0 }
    for (const i of items) {
      if (i.status === 'pool' || i.status === 'disabled') continue
      const s = getBedState(i)
      if (s === 'checked-in' || s === 'walked-in') c.occupied++
      else if (s === 'expected') c.reserved++
      else if (s === 'comp') c.comp++
      else if (s === 'available') c.free++
    }
    return c
  }, [items])

  if (!grid && !error) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.siteName}>{pairing?.siteName ?? grid?.site.name ?? ''}</Text>
        <View style={styles.counterRow}>
          <Counter tint={statusTints.occupied} n={counters.occupied} label="occupied" />
          <Counter tint={statusTints.reserved} n={counters.reserved} label="reserved" />
          {counters.comp > 0 && <Counter tint={statusTints.comp} n={counters.comp} label="comp" />}
          <Counter tint={statusTints.free} n={counters.free} label="free" />
        </View>
        {parcels.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.parcelScroll}>
            <View style={styles.parcelRow}>
              {parcels.map(p => {
                const active = activeParcel === p
                return (
                  <Pressable
                    key={p}
                    onPress={() => setParcel(p)}
                    style={[styles.parcelTab, active && styles.parcelTabActive]}
                  >
                    <Text style={[styles.parcelTabText, active && styles.parcelTabTextActive]}>
                      Parcel {p}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </ScrollView>
        )}
      </View>
      {error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : layout ? (
        <GridCanvas layout={layout} />
      ) : (
        <View style={styles.center}>
          <Text style={styles.error}>No sunbeds on this site yet.</Text>
        </View>
      )}
    </View>
  )
}

function Counter({
  tint,
  n,
  label,
}: {
  tint: { bg: string; border: string; text: string }
  n: number
  label: string
}) {
  return (
    <View style={[styles.counter, { backgroundColor: tint.bg, borderColor: tint.border }]}>
      <Text style={[styles.counterN, { color: tint.text }]}>{n}</Text>
      <Text style={[styles.counterLabel, { color: tint.text }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.pageBg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { fontSize: 14, color: colors.danger, textAlign: 'center', padding: 24 },
  header: {
    backgroundColor: colors.cardBg,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.chipBg,
    gap: 10,
    zIndex: 1,
  },
  siteName: { fontSize: 17, fontWeight: '600', color: colors.heading },
  counterRow: { flexDirection: 'row', gap: 6 },
  counter: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  counterN: { fontSize: 13, fontWeight: '700' },
  counterLabel: { fontSize: 11 },
  parcelScroll: { marginHorizontal: -16, paddingHorizontal: 16 },
  parcelRow: { flexDirection: 'row', gap: 6, paddingRight: 24 },
  parcelTab: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.borderInput,
  },
  parcelTabActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  parcelTabText: { fontSize: 13, fontWeight: '500', color: colors.body },
  parcelTabTextActive: { color: '#ffffff', fontWeight: '600' },
})
