import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getActiveReservation, getBedState } from '@repo/floor-core/bed-state'
import type { InventoryItem } from '@repo/floor-core/types'
import BedDetailSheet from '@/components/BedDetail'
import BulkSheet from '@/components/BulkSheet'
import GridCanvas from '@/components/GridCanvas'
import TillSheet from '@/components/TillSheet'
import WorkerSheet from '@/components/WorkerSheet'
import { PersonIcon } from '@/components/icons'
import { decodeSeatNumber } from '@repo/data/seat-label'
import { rpc } from '@/lib/api'
import { buildParcelLayout, parcelNumbers, type HitRect } from '@/lib/grid-layout'
import { refreshGrid, useGridStore } from '@/lib/grid-store'
import { consumeLocate } from '@/lib/locate'
import { loadWorkerId, saveWorkerId, workerInitials } from '@/lib/worker'
import { colors, statusTints } from '@/theme'

/**
 * The sunbed grid — the web manage grid's core screen: live data, parcel
 * tabs, state counters, and the pan/pinch-zoom canvas (GridCanvas).
 * Bed-detail sheet, multiselect and move mode come next.
 */
export default function Beds() {
  const insets = useSafeAreaInsets()
  const { pairing, grid, error } = useGridStore()
  const [parcel, setParcel] = useState<number | null>(null)
  const [selected, setSelected] = useState<{ id: string; isPool: boolean; isGroupExtra: boolean } | null>(null)
  const [workerId, setWorkerId] = useState<string | null>(null)
  const [showWorkers, setShowWorkers] = useState(false)
  const [showTill, setShowTill] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [movingRes, setMovingRes] = useState<{ id: string; count: number } | null>(null)
  const [moveQueue, setMoveQueue] = useState<string[]>([])
  const [moveError, setMoveError] = useState<string | null>(null)
  const [movePending, setMovePending] = useState(false)


  const items: InventoryItem[] = grid?.site.inventoryItems ?? []
  const employees = grid?.employees ?? []

  useEffect(() => {
    if (!pairing || !grid) return
    loadWorkerId(pairing.siteId, grid.employees).then(setWorkerId)
    // Roster-validated once per grid identity; re-running on refresh is harmless.
  }, [pairing, grid])

  const currentWorker = employees.find(e => e.id === workerId) ?? null

  // Guests-tab locate: switch to the seat's parcel and open its sheet.
  useFocusEffect(
    useCallback(() => {
      const itemId = consumeLocate()
      if (!itemId) return
      const item = items.find(i => i.id === itemId)
      if (!item) return
      setParcel(decodeSeatNumber(item.number).parcel)
      setSelectedIds([])
      setMovingRes(null)
      setSelected({ id: item.id, isPool: item.status === 'pool', isGroupExtra: item.status === 'pool' && !!item.sunbedGroupId })
    }, [items]),
  )

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

  // Re-resolve the selected item from the freshest grid so server-side changes
  // (a collected payment, the 30 s poll) appear live in the open sheet.
  const liveSelectedItem = selected ? items.find(i => i.id === selected.id) ?? null : null
  const selectedGroupItems =
    liveSelectedItem?.sunbedGroupId
      ? items.filter(i => i.id !== liveSelectedItem.id && i.sunbedGroupId === liveSelectedItem.sunbedGroupId)
      : []
  const selectedReservationItemIds = (() => {
    if (!liveSelectedItem) return []
    const activeRes = getActiveReservation(liveSelectedItem)
    if (!activeRes) return []
    return items.filter(i => getActiveReservation(i)?.id === activeRes.id).map(i => i.id)
  })()

  // ── Move mode (web parity: banner → tap picks the destination) ──────────
  const startMove = useCallback(
    (reservationIds: string[]) => {
      const [first, ...rest] = reservationIds
      if (!first) return
      const count = items.filter(i => getActiveReservation(i)?.id === first).length || 1
      setSelected(null)
      setSelectedIds([])
      setMovingRes({ id: first, count })
      setMoveQueue(rest)
      setMoveError(null)
    },
    [items],
  )

  const cancelMove = useCallback(() => {
    setMovingRes(null)
    setMoveQueue([])
    setMoveError(null)
  }, [])

  const handleMoveDestination = useCallback(
    async (item: InventoryItem) => {
      if (!movingRes || movePending || !pairing) return
      setMoveError(null)
      if (getBedState(item) !== 'available') {
        setMoveError('That seat is occupied — pick a free one')
        return
      }
      let destIds: string[]
      if (movingRes.count === 1) {
        destIds = [item.id]
      } else {
        // N-seat booking needs a fully-free group of the same size, extras included.
        const grp = item.sunbedGroupId ? items.filter(i => i.sunbedGroupId === item.sunbedGroupId) : []
        const allFree = grp.length > 0 && grp.every(i => getBedState(i) === 'available')
        if (grp.length !== movingRes.count || !allFree) {
          setMoveError(`Pick a free group of ${movingRes.count} seats`)
          return
        }
        destIds = grp.map(i => i.id)
      }
      setMovePending(true)
      try {
        const res = await rpc('moveReservationToSeats', [pairing.siteId, movingRes.id, destIds, pairing.accessKey])
        if (res.status === 'ok') {
          const next = moveQueue[0]
          if (next) {
            const count = items.filter(i => getActiveReservation(i)?.id === next).length || 1
            setMoveQueue(q => q.slice(1))
            setMovingRes({ id: next, count })
          } else {
            setMovingRes(null)
          }
          void refreshGrid()
        } else {
          setMoveError(res.errors?.[0] ?? 'Move failed')
        }
      } catch {
        setMoveError('Could not reach the server.')
      } finally {
        setMovePending(false)
      }
    },
    [movingRes, movePending, items, moveQueue, pairing],
  )

  // Tap dispatch by mode: move destination → selection toggle → bed detail.
  const onTapCell = useCallback(
    (hit: HitRect | null) => {
      if (movingRes) {
        if (hit) void handleMoveDestination(hit.item)
        return
      }
      if (selectedIds.length > 0) {
        if (!hit) {
          setSelectedIds([])
          return
        }
        setSelectedIds(ids =>
          ids.includes(hit.item.id) ? ids.filter(x => x !== hit.item.id) : [...ids, hit.item.id],
        )
        return
      }
      if (hit) setSelected({ id: hit.item.id, isPool: hit.isPool, isGroupExtra: hit.isGroupExtra })
    },
    [movingRes, selectedIds.length, handleMoveDestination],
  )

  const onLongPressCell = useCallback(
    (hit: HitRect) => {
      if (movingRes) return
      setSelected(null)
      setSelectedIds(ids => (ids.includes(hit.item.id) ? ids : [...ids, hit.item.id]))
    },
    [movingRes],
  )

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
        <View style={styles.titleRow}>
          <Text style={styles.siteName}>{pairing?.siteName ?? grid?.site.name ?? ''}</Text>
          {employees.length > 0 && (
            <Pressable
              onPress={() => setShowWorkers(true)}
              style={[styles.workerChip, currentWorker && styles.workerChipActive]}
            >
              {currentWorker ? (
                <Text style={styles.workerChipText}>{workerInitials(currentWorker.name)}</Text>
              ) : (
                <PersonIcon />
              )}
            </Pressable>
          )}
        </View>
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
        <>
          {movingRes && (
            <View style={styles.moveBanner}>
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.moveBannerText}>
                  {movingRes.count > 1
                    ? `Tap a free group of ${movingRes.count} seats to move here`
                    : 'Tap a free seat to move here'}
                  {moveQueue.length > 0 ? ` · ${moveQueue.length} more after this` : ''}
                </Text>
                {moveError && <Text style={styles.moveErrorText}>{moveError}</Text>}
              </View>
              <Pressable onPress={cancelMove} style={styles.moveCancelBtn}>
                <Text style={styles.moveCancelText}>Cancel</Text>
              </Pressable>
            </View>
          )}
          <GridCanvas
            layout={layout}
            onTapCell={onTapCell}
            onLongPressCell={onLongPressCell}
            selectedIds={selectedIds}
          />
        </>
      ) : (
        <View style={styles.center}>
          <Text style={styles.error}>No sunbeds on this site yet.</Text>
        </View>
      )}
      {selectedIds.length > 0 && !movingRes && pairing && (
        <BulkSheet
          siteId={pairing.siteId}
          accessKey={pairing.accessKey}
          items={items}
          selectedIds={selectedIds}
          workerId={workerId ?? undefined}
          siteIsPaid={grid?.site.type === 'paid'}
          onClearSelection={() => setSelectedIds([])}
          onChanged={() => void refreshGrid()}
          onStartMove={startMove}
        />
      )}
      {showWorkers && pairing && (
        <WorkerSheet
          employees={employees}
          currentWorkerId={workerId}
          onSelect={id => {
            setWorkerId(id)
            void saveWorkerId(pairing.siteId, id)
            setShowWorkers(false)
          }}
          onOpenTill={() => {
            setShowWorkers(false)
            setShowTill(true)
          }}
          onClose={() => setShowWorkers(false)}
        />
      )}
      {showTill && pairing && currentWorker && (
        <TillSheet
          siteId={pairing.siteId}
          accessKey={pairing.accessKey}
          worker={currentWorker}
          onClose={() => setShowTill(false)}
          onClosed={() => void refreshGrid()}
        />
      )}
      {liveSelectedItem && pairing && selected && (
        <BedDetailSheet
          siteId={pairing.siteId}
          accessKey={pairing.accessKey}
          item={liveSelectedItem}
          groupItems={selectedGroupItems}
          reservationItemIds={selectedReservationItemIds}
          isPool={selected.isPool}
          isGroupExtra={selected.isGroupExtra}
          siteIsPaid={grid?.site.type === 'paid'}
          currentWorkerId={workerId ?? undefined}
          onClose={() => setSelected(null)}
          onChanged={() => void refreshGrid()}
          onMove={resId => startMove([resId])}
        />
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
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  workerChip: {
    width: 34, height: 34, borderRadius: 999, backgroundColor: colors.cardBg,
    borderWidth: 1, borderColor: colors.borderInput,
    alignItems: 'center', justifyContent: 'center',
    // In Expo Go the floating dev-tools button covers the top-right corner —
    // shift the chip clear of it in dev only.
    marginRight: __DEV__ ? 56 : 0,
  },
  workerChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  workerChipText: { fontSize: 12, fontWeight: '600', color: '#ffffff' },
  moveBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#eff6ff', borderBottomWidth: 1, borderBottomColor: '#bfdbfe',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  moveBannerText: { fontSize: 13, fontWeight: '500', color: '#1d4ed8', flexShrink: 1 },
  moveErrorText: { fontSize: 12, color: '#dc2626', marginTop: 2 },
  moveCancelBtn: {
    marginLeft: 'auto', paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 8, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#bfdbfe',
  },
  moveCancelText: { fontSize: 13, fontWeight: '600', color: '#1d4ed8' },
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
