'use client'

import { useEffect, useRef, useState } from 'react'

import type {
  ElementPaletteConfig,
  ItemVisual,
  LayoutElementDTO,
  SchematicItem,
  WorldDims,
} from './types'

export interface SchematicRendererProps {
  world: WorldDims
  bgImageUrl?: string | null
  paletteConfig: ElementPaletteConfig
  elements: LayoutElementDTO[]
  items: SchematicItem[]
  itemVisual: (item: SchematicItem) => ItemVisual
  mode: 'view' | 'edit'
  placementActive?: boolean
  selection?: { itemIds?: string[]; elementId?: string | null }
  onItemClick?: (id: string, mods: { metaKey: boolean; ctrlKey: boolean }) => void
  onItemDragEnd?: (id: string, x: number, y: number) => void
  onElementClick?: (id: string) => void
  onElementDoubleClick?: (id: string) => void
  onElementDragEnd?: (id: string, x: number, y: number) => void
  onElementResizeEnd?: (id: string, x: number, y: number, width: number, height: number) => void
  onBackgroundClick?: (x: number, y: number) => void
}

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

interface DragState {
  kind: 'item' | 'element' | 'resize'
  id: string
  handle?: ResizeHandle
  startScreenX: number
  startScreenY: number
  startX: number
  startY: number
  startWidth: number
  startHeight: number
  currentX: number
  currentY: number
  currentWidth: number
  currentHeight: number
  moved: boolean
}

const MIN_ELEMENT_SIZE = 0.5

function applyResize(handle: ResizeHandle, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number) {
  let x = sx
  let y = sy
  let w = sw
  let h = sh
  if (handle.includes('e')) w = Math.max(MIN_ELEMENT_SIZE, sw + dx)
  if (handle.includes('s')) h = Math.max(MIN_ELEMENT_SIZE, sh + dy)
  if (handle.includes('w')) {
    const newW = Math.max(MIN_ELEMENT_SIZE, sw - dx)
    x = sx + (sw - newW)
    w = newW
  }
  if (handle.includes('n')) {
    const newH = Math.max(MIN_ELEMENT_SIZE, sh - dy)
    y = sy + (sh - newH)
    h = newH
  }
  return { x, y, w, h }
}

export function SchematicRenderer(props: SchematicRendererProps) {
  const {
    world,
    bgImageUrl,
    paletteConfig,
    elements,
    items,
    itemVisual,
    mode,
    placementActive,
    selection,
  } = props
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const VIEWBOX_MARGIN = mode === 'edit' ? 0.08 : 0
  const [viewBox, setViewBox] = useState<{ x: number; y: number; w: number; h: number }>({
    x: -world.width * VIEWBOX_MARGIN,
    y: -world.height * VIEWBOX_MARGIN,
    w: world.width * (1 + 2 * VIEWBOX_MARGIN),
    h: world.height * (1 + 2 * VIEWBOX_MARGIN),
  })
  const viewBoxRef = useRef(viewBox)
  viewBoxRef.current = viewBox
  // Multi-touch gesture tracker (ref to avoid re-renders during gesture)
  const gestureRef = useRef<{
    pointers: Map<number, { cx: number; cy: number }>
    startVb: { x: number; y: number; w: number; h: number }
    startPointers: Map<number, { cx: number; cy: number }>
    moved: boolean
    tapWorldX: number
    tapWorldY: number
  } | null>(null)
  const [gestureActive, setGestureActive] = useState(false)

  function clampViewBox(vb: { x: number; y: number; w: number; h: number }) {
    const aspect = world.width / world.height
    let w = vb.w
    let h = w / aspect
    const maxW = world.width * (1 + 2 * VIEWBOX_MARGIN)
    // Cap zoom-in at ~6 sunbed lengths wide so sunbeds never dominate the view.
    const minW = Math.min(6 * 2.1, world.width)
    if (w > maxW) { w = maxW; h = w / aspect }
    if (w < minW) { w = minW; h = w / aspect }
    const minX = -world.width * VIEWBOX_MARGIN
    const maxX = world.width * (1 + VIEWBOX_MARGIN) - w
    const minY = -world.height * VIEWBOX_MARGIN
    const maxY = world.height * (1 + VIEWBOX_MARGIN) - h
    const x = Math.max(minX, Math.min(maxX, vb.x))
    const y = Math.max(minY, Math.min(maxY, vb.y))
    return { x, y, w, h }
  }

  useEffect(() => {
    setViewBox({
      x: -world.width * VIEWBOX_MARGIN,
      y: -world.height * VIEWBOX_MARGIN,
      w: world.width * (1 + 2 * VIEWBOX_MARGIN),
      h: world.height * (1 + 2 * VIEWBOX_MARGIN),
    })
  }, [world.width, world.height])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const update = () => {
      const rect = svg.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      setContainerSize({ w: rect.width, h: rect.height })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(svg)
    return () => ro.disconnect()
  }, [])

  // World units per screen pixel — used to make handle squares constant on-screen.
  const pxScale = containerSize.w > 0 && containerSize.h > 0
    ? Math.min(containerSize.w / viewBox.w, containerSize.h / viewBox.h)
    : 1
  const worldPerPx = pxScale > 0 ? 1 / pxScale : 1

  const sortedElements = [...elements].sort((a, b) => {
    const za = paletteConfig[a.type]?.zBand ?? a.z
    const zb = paletteConfig[b.type]?.zBand ?? b.z
    return za - zb
  })

  const selectedItemIds = new Set(selection?.itemIds ?? [])
  const selectedElementId = selection?.elementId ?? null

  function screenToWorld(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const vb = viewBoxRef.current
    // Account for preserveAspectRatio="xMidYMid meet" (uniform scale, centered) over the current viewBox.
    const scale = Math.min(rect.width / vb.w, rect.height / vb.h)
    const offsetX = (rect.width - scale * vb.w) / 2
    const offsetY = (rect.height - scale * vb.h) / 2
    return {
      x: (clientX - rect.left - offsetX) / scale + vb.x,
      y: (clientY - rect.top - offsetY) / scale + vb.y,
    }
  }

  useEffect(() => {
    if (!drag) return
    const handleMove = (e: PointerEvent) => {
      const w = screenToWorld(e.clientX, e.clientY)
      if (!w) return
      const dxScreen = Math.abs(e.clientX - drag.startScreenX)
      const dyScreen = Math.abs(e.clientY - drag.startScreenY)
      const moved = drag.moved || dxScreen > 3 || dyScreen > 3
      const startW = screenToWorld(drag.startScreenX, drag.startScreenY)
      const dx = startW ? w.x - startW.x : 0
      const dy = startW ? w.y - startW.y : 0
      if (drag.kind === 'resize' && drag.handle) {
        const r = applyResize(drag.handle, drag.startX, drag.startY, drag.startWidth, drag.startHeight, dx, dy)
        setDrag({ ...drag, currentX: r.x, currentY: r.y, currentWidth: r.w, currentHeight: r.h, moved })
        return
      }
      setDrag({ ...drag, currentX: drag.startX + dx, currentY: drag.startY + dy, moved })
    }
    const handleUp = () => {
      if (drag.moved) {
        if (drag.kind === 'item') {
          props.onItemDragEnd?.(drag.id, drag.currentX, drag.currentY)
        } else if (drag.kind === 'element') {
          props.onElementDragEnd?.(drag.id, drag.currentX, drag.currentY)
        } else if (drag.kind === 'resize') {
          props.onElementResizeEnd?.(drag.id, drag.currentX, drag.currentY, drag.currentWidth, drag.currentHeight)
        }
      } else {
        if (drag.kind === 'item') {
          props.onItemClick?.(drag.id, { metaKey: false, ctrlKey: false })
        } else if (drag.kind === 'element') {
          props.onElementClick?.(drag.id)
        }
      }
      setDrag(null)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [drag, props.onItemDragEnd, props.onItemClick, props.onElementDragEnd, props.onElementClick, props.onElementResizeEnd])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      const rect = svg.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      e.preventDefault()
      const vb = viewBoxRef.current
      const scale = Math.min(rect.width / vb.w, rect.height / vb.h)
      const offsetX = (rect.width - scale * vb.w) / 2
      const offsetY = (rect.height - scale * vb.h) / 2
      const wx = (e.clientX - rect.left - offsetX) / scale + vb.x
      const wy = (e.clientY - rect.top - offsetY) / scale + vb.y
      const factor = Math.exp(e.deltaY * 0.0015)
      const proposedW = vb.w * factor
      const aspect = world.width / world.height
      const proposedH = proposedW / aspect
      const proposedX = wx - (wx - vb.x) * (proposedW / vb.w)
      const proposedY = wy - (wy - vb.y) * (proposedH / vb.h)
      setViewBox(clampViewBox({ x: proposedX, y: proposedY, w: proposedW, h: proposedH }))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [world.width, world.height])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gestureRef.current
      if (!g || !g.pointers.has(e.pointerId)) return
      g.pointers.set(e.pointerId, { cx: e.clientX, cy: e.clientY })

      const svg = svgRef.current
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const vb = g.startVb
      const scale = Math.min(rect.width / vb.w, rect.height / vb.h)
      if (scale <= 0) return

      const startPts = Array.from(g.startPointers.values())
      const currPts = Array.from(g.pointers.values())

      if (currPts.length === 1 && startPts.length === 1) {
        // Single-finger pan
        const dx = (currPts[0]!.cx - startPts[0]!.cx) / scale
        const dy = (currPts[0]!.cy - startPts[0]!.cy) / scale
        if (Math.abs(currPts[0]!.cx - startPts[0]!.cx) > 3 ||
            Math.abs(currPts[0]!.cy - startPts[0]!.cy) > 3) g.moved = true
        if (g.moved) {
          setViewBox(clampViewBox({ x: vb.x - dx, y: vb.y - dy, w: vb.w, h: vb.h }))
        }
      } else if (currPts.length >= 2 && startPts.length >= 2) {
        // Two-finger pinch + pan
        const dist = (a: { cx: number; cy: number }, b: { cx: number; cy: number }) =>
          Math.hypot(b.cx - a.cx, b.cy - a.cy)
        const mid = (a: { cx: number; cy: number }, b: { cx: number; cy: number }) =>
          ({ cx: (a.cx + b.cx) / 2, cy: (a.cy + b.cy) / 2 })

        const d0 = dist(startPts[0]!, startPts[1]!)
        const d1 = dist(currPts[0]!, currPts[1]!)
        const pinchFactor = d0 > 0 ? d0 / d1 : 1

        const m0 = mid(startPts[0]!, startPts[1]!)
        const m1 = mid(currPts[0]!, currPts[1]!)

        const aspect = world.width / world.height
        const newW = vb.w * pinchFactor
        const newH = newW / aspect

        // World point under the initial gesture midpoint
        const offsetX = (rect.width - scale * vb.w) / 2
        const offsetY = (rect.height - scale * vb.h) / 2
        const worldAnchorX = (m0.cx - rect.left - offsetX) / scale + vb.x
        const worldAnchorY = (m0.cy - rect.top - offsetY) / scale + vb.y

        // Zoom toward that anchor, then translate to follow midpoint movement
        const zoomedX = worldAnchorX - (worldAnchorX - vb.x) * (newW / vb.w)
        const zoomedY = worldAnchorY - (worldAnchorY - vb.y) * (newH / vb.h)
        const panDx = (m1.cx - m0.cx) / scale
        const panDy = (m1.cy - m0.cy) / scale

        setViewBox(clampViewBox({ x: zoomedX - panDx, y: zoomedY - panDy, w: newW, h: newH }))
      }
    }

    const onUp = (e: PointerEvent) => {
      const g = gestureRef.current
      if (!g || !g.pointers.has(e.pointerId)) return
      g.pointers.delete(e.pointerId)

      if (g.pointers.size === 0) {
        setGestureActive(false)
        if (!g.moved) {
          props.onBackgroundClick?.(g.tapWorldX, g.tapWorldY)
        }
        gestureRef.current = null
      } else {
        // One finger lifted during pinch — restart pan from current state
        g.startVb = { ...viewBoxRef.current }
        g.startPointers = new Map(g.pointers)
        g.moved = true
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [world.width, world.height])

  const startItemDrag = (item: SchematicItem) => (e: React.PointerEvent) => {
    if (mode !== 'edit') return
    e.stopPropagation()
    setDrag({
      kind: 'item',
      id: item.id,
      startScreenX: e.clientX,
      startScreenY: e.clientY,
      startX: item.x,
      startY: item.y,
      startWidth: 0,
      startHeight: 0,
      currentX: item.x,
      currentY: item.y,
      currentWidth: 0,
      currentHeight: 0,
      moved: false,
    })
  }

  const startElementDrag = (el: LayoutElementDTO) => (e: React.PointerEvent) => {
    if (mode !== 'edit') return
    e.stopPropagation()
    setDrag({
      kind: 'element',
      id: el.id,
      startScreenX: e.clientX,
      startScreenY: e.clientY,
      startX: el.x,
      startY: el.y,
      startWidth: el.width,
      startHeight: el.height,
      currentX: el.x,
      currentY: el.y,
      currentWidth: el.width,
      currentHeight: el.height,
      moved: false,
    })
  }

  const startElementResize = (el: LayoutElementDTO, handle: ResizeHandle) => (e: React.PointerEvent) => {
    if (mode !== 'edit') return
    e.stopPropagation()
    setDrag({
      kind: 'resize',
      id: el.id,
      handle,
      startScreenX: e.clientX,
      startScreenY: e.clientY,
      startX: el.x,
      startY: el.y,
      startWidth: el.width,
      startHeight: el.height,
      currentX: el.x,
      currentY: el.y,
      currentWidth: el.width,
      currentHeight: el.height,
      moved: false,
    })
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        width: '100%',
        height: '100%',
        background: '#f3f4f6',
        userSelect: 'none',
        cursor: gestureActive ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return
        if (e.button === 1) e.preventDefault()
        const w = screenToWorld(e.clientX, e.clientY)
        if (!w) return
        const pt = { cx: e.clientX, cy: e.clientY }
        const g = gestureRef.current
        if (!g) {
          gestureRef.current = {
            pointers: new Map([[e.pointerId, pt]]),
            startVb: { ...viewBoxRef.current },
            startPointers: new Map([[e.pointerId, pt]]),
            moved: false,
            tapWorldX: w.x,
            tapWorldY: w.y,
          }
          setGestureActive(true)
        } else {
          // Second finger: snapshot current state as pinch start
          g.pointers.set(e.pointerId, pt)
          g.startVb = { ...viewBoxRef.current }
          g.startPointers = new Map(g.pointers)
          g.moved = true
        }
      }}
    >
      <rect
        x={0}
        y={0}
        width={world.width}
        height={world.height}
        fill="#ffffff"
        stroke={mode === 'edit' ? '#94a3b8' : 'none'}
        strokeWidth={2 * worldPerPx}
        pointerEvents="none"
      />

      {mode === 'edit' ? (() => {
        const fontSize = 12 * worldPerPx
        const offset = 10 * worldPerPx
        const fmt = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} m`
        return (
          <g pointerEvents="none" fill="#475569" fontWeight={500}>
            <text
              x={world.width / 2}
              y={-offset}
              textAnchor="middle"
              dominantBaseline="alphabetic"
              fontSize={fontSize}
            >
              {fmt(world.width)}
            </text>
            <text
              x={-offset}
              y={world.height / 2}
              textAnchor="middle"
              dominantBaseline="alphabetic"
              fontSize={fontSize}
              transform={`rotate(-90 ${-offset} ${world.height / 2})`}
            >
              {fmt(world.height)}
            </text>
          </g>
        )
      })() : null}

      {bgImageUrl ? (
        <image
          href={bgImageUrl}
          x={0}
          y={0}
          width={world.width}
          height={world.height}
          preserveAspectRatio="xMidYMid slice"
        />
      ) : null}

      {sortedElements.map((el) => {
        const visual = paletteConfig[el.type]
        const fill = el.color ?? visual?.fill ?? '#cbd5e1'
        const stroke = visual?.stroke ?? '#1f2937'
        const isSelected = el.id === selectedElementId
        const isMoving = drag?.kind === 'element' && drag.id === el.id
        const isResizing = drag?.kind === 'resize' && drag.id === el.id
        const x = isMoving ? drag.currentX : isResizing ? drag.currentX : el.x
        const y = isMoving ? drag.currentY : isResizing ? drag.currentY : el.y
        const w = isResizing ? drag.currentWidth : el.width
        const h = isResizing ? drag.currentHeight : el.height
        const cx = x + w / 2
        const cy = y + h / 2
        const transform = el.rotation ? `rotate(${el.rotation} ${cx} ${cy})` : undefined
        const baseProps = {
          fill,
          stroke,
          strokeWidth: isSelected ? 0.18 : 0.06,
          opacity: 0.85,
          transform,
          onPointerDown: placementActive ? undefined : startElementDrag(el),
          onClick: (e: React.MouseEvent) => {
            if (placementActive) return
            e.stopPropagation()
          },
          onDoubleClick: (e: React.MouseEvent) => {
            if (placementActive) return
            e.stopPropagation()
            props.onElementDoubleClick?.(el.id)
          },
          style: {
            cursor: placementActive ? 'crosshair' : mode === 'edit' ? 'move' : 'default',
            pointerEvents: placementActive ? 'none' : undefined,
          } as React.CSSProperties,
        }
        const labelText = el.label ?? null
        const handleSize = 10 * worldPerPx
        const handleStroke = 1.5 * worldPerPx
        const handles: { key: ResizeHandle; cx: number; cy: number; cursor: string }[] = [
          { key: 'nw', cx: x,         cy: y,         cursor: 'nwse-resize' },
          { key: 'n',  cx: x + w / 2, cy: y,         cursor: 'ns-resize'   },
          { key: 'ne', cx: x + w,     cy: y,         cursor: 'nesw-resize' },
          { key: 'e',  cx: x + w,     cy: y + h / 2, cursor: 'ew-resize'   },
          { key: 'se', cx: x + w,     cy: y + h,     cursor: 'nwse-resize' },
          { key: 's',  cx: x + w / 2, cy: y + h,     cursor: 'ns-resize'   },
          { key: 'sw', cx: x,         cy: y + h,     cursor: 'nesw-resize' },
          { key: 'w',  cx: x,         cy: y + h / 2, cursor: 'ew-resize'   },
        ]
        return (
          <g key={el.id}>
            {el.shape === 'ellipse' ? (
              <ellipse {...baseProps} cx={cx} cy={cy} rx={w / 2} ry={h / 2} />
            ) : (
              <rect {...baseProps} x={x} y={y} width={w} height={h} rx={0.2} ry={0.2} />
            )}
            {labelText ? (
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={Math.min(1.2, h * 0.35)}
                fill="#0f172a"
                pointerEvents="none"
                fontWeight={500}
              >
                {labelText}
              </text>
            ) : null}
            {isSelected ? (
              <>
                <rect
                  x={x - 0.05}
                  y={y - 0.05}
                  width={w + 0.1}
                  height={h + 0.1}
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth={0.1}
                  strokeDasharray="0.4 0.2"
                  pointerEvents="none"
                  transform={transform}
                />
                {mode === 'edit' && !placementActive && handles.map((hd) => (
                  <rect
                    key={hd.key}
                    x={hd.cx - handleSize / 2}
                    y={hd.cy - handleSize / 2}
                    width={handleSize}
                    height={handleSize}
                    fill="#fff"
                    stroke="#2563eb"
                    strokeWidth={handleStroke}
                    transform={transform}
                    onPointerDown={startElementResize(el, hd.key)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ cursor: hd.cursor }}
                  />
                ))}
              </>
            ) : null}
          </g>
        )
      })}

      {(() => {
        const draggedItem = drag?.kind === 'item' ? items.find((i) => i.id === drag.id) : null
        const dragGroup =
          draggedItem && draggedItem.group && draggedItem.group > 0 ? draggedItem.group : null
        const dragOffsetX = drag?.kind === 'item' && draggedItem ? drag.currentX - draggedItem.x : 0
        const dragOffsetY = drag?.kind === 'item' && draggedItem ? drag.currentY - draggedItem.y : 0
        return items.map((item) => {
        const v = itemVisual(item)
        const w = 0.84
        const h = 2.1
        const isSelected = selectedItemIds.has(item.id)
        const isDragging = drag?.kind === 'item' && drag.id === item.id
        const isGroupSibling =
          !isDragging && dragGroup !== null && item.group === dragGroup
        const cx = isDragging
          ? drag.currentX
          : isGroupSibling
            ? item.x + dragOffsetX
            : item.x
        const cy = isDragging
          ? drag.currentY
          : isGroupSibling
            ? item.y + dragOffsetY
            : item.y
        const transform = item.rotation ? `rotate(${item.rotation} ${cx} ${cy})` : undefined
        const strokeColor = v.stroke ?? '#1f2937'
        const hasImage = !!v.sunbedImageUrl
        const cornerRadius = hasImage ? 0 : w * 0.12

        // Image mode: PNG renders at its natural aspect (physical 2.1m length),
        // and the fill rect is just a ~2px colored halo around it acting as a
        // status indicator. Partner (no image) uses the spatial rect w × h.
        const pngH = h
        const pngW = hasImage ? pngH * 0.48 : 0
        const pngX = (cx - pngW / 2) + 0.05
        const pngY = cy - pngH / 2

        // Halo proportional to PNG height — independent of container measurement,
        // so the first paint isn't blown out before ResizeObserver fires.
        const halo = 0 //hasImage ? pngH * 0.00 : 0
        const fillW = hasImage ? pngW + 2 * halo : w
        const fillH = hasImage ? pngH + 2 * halo : h
        const fillX = cx - fillW / 2
        const fillY = cy - fillH / 2

        // Thin 1px black border always — fill color change conveys selection.
        const sx = hasImage
          ? Math.max(1 * worldPerPx, pngH * 0.005)
          : (isSelected ? 0.16 : 0.04)

        // Towel: proportional to PNG, 30° rotation around own center
        const towelH = pngH / 2
        const towelW = towelH
        const towelX = cx - towelW / 2
        const towelY = pngY + pngH * (1 - 1 / 2.8)
        const towelCy = towelY + towelH / 2

        return (
          <g key={item.id} transform={transform}>
            {/* Solid background — fully opaque, matches map marker backgroundColor */}
            <rect
              x={fillX}
              y={fillY}
              width={fillW}
              height={fillH}
              rx={cornerRadius}
              ry={cornerRadius}
              fill={v.fill}
              stroke={strokeColor}
              strokeWidth={sx}
              onPointerDown={placementActive ? undefined : startItemDrag(item)}
              onClick={(e) => {
                if (placementActive) return
                e.stopPropagation()
                if (drag?.moved) return
                props.onItemClick?.(item.id, { metaKey: e.metaKey, ctrlKey: e.ctrlKey })
              }}
              style={{
                cursor: placementActive
                  ? 'crosshair'
                  : mode === 'edit' || props.onItemClick
                    ? 'pointer'
                    : 'default',
                pointerEvents: placementActive ? 'none' : undefined,
              } as React.CSSProperties}
            />
            {/* Sunbed PNG: natural aspect, centered horizontally, top-aligned in fill */}
            {v.sunbedImageUrl && (
              <image
                href={v.sunbedImageUrl}
                x={pngX}
                y={pngY}
                width={pngW}
                height={pngH}
                preserveAspectRatio="xMidYMid meet"
                pointerEvents="none"
              />
            )}
            {/* Beach towel PNG: overflows seat bottom as on map, rotated 30° */}
            {v.towelImageUrl && (
              <image
                href={v.towelImageUrl}
                x={towelX}
                y={towelY}
                width={towelW}
                height={towelH}
                preserveAspectRatio="xMidYMid meet"
                transform={`rotate(30 ${cx} ${towelCy})`}
                pointerEvents="none"
              />
            )}
            {/* Headrest separator (only in edit mode without PNG) */}
            {!hasImage && (
              <line
                x1={cx - w / 2 + w * 0.15}
                y1={cy - h / 2 + h * 0.2}
                x2={cx + w / 2 - w * 0.15}
                y2={cy - h / 2 + h * 0.2}
                stroke={strokeColor}
                strokeWidth={sx * 0.6}
                strokeOpacity={0.45}
                strokeLinecap="round"
                pointerEvents="none"
              />
            )}
            {v.label ? (
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={0.38}
                fill="#1f2937"
                pointerEvents="none"
                fontWeight={600}
                fontFamily="system-ui, -apple-system, sans-serif"
                transform={`rotate(90 ${cx} ${cy})`}
              >
                {v.label}
              </text>
            ) : null}
          </g>
        )
        })
      })()}
    </svg>
  )
}
