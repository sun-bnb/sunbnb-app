/**
 * The pan/pinch-zoom parcel canvas — RN port of the web manage grid's
 * transform surface (view.tsx): one content layer, translate+scale from the
 * top-left origin, 1-finger pan, 2-finger pinch around the focal point,
 * clamped like the web's clampAxis (centered horizontally / top-anchored
 * vertically when smaller than the viewport), fit-to-view on parcel switch,
 * per-cell detail hidden below 0.6× zoom.
 */
import React, { memo, useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated'
import { formatSeatId } from '@repo/data/seat-label'
import { getCellAppearance } from '@repo/floor-core/bed-state'
import type { InventoryItem } from '@repo/floor-core/types'
import {
  CELL_GAP, CELL_H, CELL_W, GROUP_GAP_PX, POOL_CELL_H, POOL_CELL_W,
  ROW_LABEL_WIDTH, ROW_MB, ROW_PAD_V, poolSeq, type GridCell, type ParcelLayout,
} from '@/lib/grid-layout'
import { cellColors, colors } from '@/theme'

const ZOOM_MIN = 0.1
const ZOOM_MAX = 2.5
const DEFAULT_ZOOM_RATIO = 0.8
const MIN_OPEN_ZOOM = 0.4
const DETAIL_HIDE_BELOW = 0.6

function clampAxis(t: number, contentScaled: number, viewport: number, start: boolean): number {
  'worklet'
  if (contentScaled <= viewport) return start ? 0 : Math.round((viewport - contentScaled) / 2)
  return Math.min(0, Math.max(viewport - contentScaled, t))
}

export default function GridCanvas({ layout }: { layout: ParcelLayout }) {
  const scale = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const vw = useSharedValue(0)
  const vh = useSharedValue(0)
  const pinchStart = useSharedValue({ scale: 1, cx: 0, cy: 0 })
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null)
  const [hideDetail, setHideDetail] = useState(false)

  const { contentW, contentH } = layout

  // Fit-to-view: same formula as the web (80% of edge-to-edge, floored at 0.4).
  useEffect(() => {
    if (!viewport) return
    const fit = Math.min(ZOOM_MAX, Math.max(MIN_OPEN_ZOOM, (viewport.w / contentW) * DEFAULT_ZOOM_RATIO))
    scale.value = fit
    tx.value = clampAxis(0, contentW * fit, viewport.w, false)
    ty.value = clampAxis(0, contentH * fit, viewport.h, true)
  }, [viewport, contentW, contentH, layout.parcelNum])

  useAnimatedReaction(
    () => scale.value < DETAIL_HIDE_BELOW,
    (hidden, prev) => {
      if (hidden !== prev) runOnJS(setHideDetail)(hidden)
    },
  )

  const pan = Gesture.Pan()
    .maxPointers(1)
    .onChange(e => {
      tx.value = clampAxis(tx.value + e.changeX, contentW * scale.value, vw.value, false)
      ty.value = clampAxis(ty.value + e.changeY, contentH * scale.value, vh.value, true)
    })

  const pinch = Gesture.Pinch()
    .onStart(e => {
      // Content point under the initial focal — kept fixed while zooming.
      pinchStart.value = {
        scale: scale.value,
        cx: (e.focalX - tx.value) / scale.value,
        cy: (e.focalY - ty.value) / scale.value,
      }
    })
    .onUpdate(e => {
      const s1 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pinchStart.value.scale * e.scale))
      scale.value = s1
      tx.value = clampAxis(e.focalX - pinchStart.value.cx * s1, contentW * s1, vw.value, false)
      ty.value = clampAxis(e.focalY - pinchStart.value.cy * s1, contentH * s1, vh.value, true)
    })

  const gestures = Gesture.Simultaneous(pan, pinch)

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }))

  const onLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number; height: number } } }) => {
      const { width, height } = e.nativeEvent.layout
      vw.value = width
      vh.value = height
      setViewport({ w: width, h: height })
    },
    [vw, vh],
  )

  return (
    <GestureDetector gesture={gestures}>
      <View style={styles.viewport} onLayout={onLayout}>
        <Animated.View
          style={[
            { width: contentW, height: contentH, transformOrigin: 'top left' },
            styles.content,
            animatedStyle,
          ]}
        >
          {layout.rows.map(({ row, cells }) => (
            <View key={row} style={[styles.row, row % 2 === 0 && styles.rowEven]}>
              <View style={styles.rowLabel}>
                <Text style={styles.rowLabelText}>R{row}</Text>
              </View>
              {cells.map(cell => (
                <CellView key={cell.key} cell={cell} hideDetail={hideDetail} />
              ))}
            </View>
          ))}
          <PoolSection poolItems={layout.poolItems} hideDetail={hideDetail} />
        </Animated.View>
      </View>
    </GestureDetector>
  )
}

const CellView = memo(function CellView({ cell, hideDetail }: { cell: GridCell; hideDetail: boolean }) {
  if (cell.kind === 'gap') return <View style={{ width: GROUP_GAP_PX }} />
  if (cell.kind === 'empty') return <View style={{ width: CELL_W, height: CELL_H }} />
  const { bg, icon } = getCellAppearance(cell.item)
  const c = cellColors(bg)
  const label = cell.kind === 'extra' ? cell.label : formatSeatId(cell.item, { parcel: false })
  return (
    <View style={[styles.cell, { backgroundColor: c.bg, borderColor: c.border }]}>
      {!hideDetail && (
        <>
          {icon === 'card' ? (
            <CardGlyph color={c.text} />
          ) : icon ? (
            <Text style={[styles.cellGlyph, { color: c.text }]}>{icon}</Text>
          ) : null}
          <Text style={[styles.cellLabel, { color: c.text }]} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </View>
  )
})

/** Tiny credit-card glyph drawn with Views (no icon lib on the canvas). */
function CardGlyph({ color }: { color: string }) {
  return (
    <View style={[styles.cardGlyph, { borderColor: color }]}>
      <View style={[styles.cardGlyphStripe, { backgroundColor: color }]} />
    </View>
  )
}

function PoolSection({ poolItems, hideDetail }: { poolItems: InventoryItem[]; hideDetail: boolean }) {
  const occupied = poolItems.filter(i => !getCellAppearance(i).bg.includes('green')).length
  return (
    <View style={styles.pool}>
      {poolItems.length > 0 && (
        <Text style={styles.poolCounter}>
          {occupied}/{poolItems.length}
        </Text>
      )}
      <View style={styles.poolCells}>
        {poolItems.map(item => {
          const { bg, icon } = getCellAppearance(item)
          const c = cellColors(bg)
          return (
            <View key={item.id} style={[styles.poolCell, { backgroundColor: c.bg, borderColor: c.border }]}>
              {!hideDetail && (
                <>
                  {icon === 'card' ? (
                    <CardGlyph color={c.text} />
                  ) : icon ? (
                    <Text style={[styles.cellGlyph, { color: c.text }]}>{icon}</Text>
                  ) : null}
                  <Text style={[styles.cellLabel, { color: c.text }]}>{poolSeq(item)}</Text>
                </>
              )}
            </View>
          )
        })}
        <View style={styles.poolAdd}>
          <Text style={styles.poolAddText}>+</Text>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden', backgroundColor: colors.pageBg },
  content: { position: 'absolute', top: 0, left: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: CELL_GAP,
    paddingVertical: ROW_PAD_V,
    marginBottom: ROW_MB,
    borderRadius: 8,
  },
  rowEven: { backgroundColor: colors.chipBg },
  rowLabel: { width: ROW_LABEL_WIDTH, alignItems: 'center', justifyContent: 'center' },
  rowLabelText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.muted,
    backgroundColor: '#f3f4f6',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  cell: {
    width: CELL_W,
    height: CELL_H,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  cellGlyph: { fontSize: 11, fontWeight: '700', lineHeight: 12 },
  cellLabel: { fontSize: 10, lineHeight: 12 },
  cardGlyph: {
    width: 13,
    height: 9,
    borderRadius: 2,
    borderWidth: 1.2,
    justifyContent: 'center',
  },
  cardGlyphStripe: { height: 1.5, marginTop: -2 },
  pool: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  poolCounter: { fontSize: 11, color: colors.faint, marginBottom: 6, fontVariant: ['tabular-nums'] },
  poolCells: { flexDirection: 'row', flexWrap: 'wrap', gap: CELL_GAP },
  poolCell: {
    width: POOL_CELL_W,
    height: POOL_CELL_H,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  poolAdd: {
    width: POOL_CELL_W,
    height: POOL_CELL_H,
    borderRadius: 8,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.borderInput,
    alignItems: 'center',
    justifyContent: 'center',
  },
  poolAddText: { fontSize: 18, color: colors.faint, fontWeight: '300' },
})
