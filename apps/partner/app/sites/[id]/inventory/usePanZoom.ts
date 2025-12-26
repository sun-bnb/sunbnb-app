// components/map/usePanZoom.ts
'use client'
import * as React from 'react'

export function usePanZoom(initialScale = 1) {
  const svgRef = React.useRef<SVGSVGElement | null>(null)
  const [scale, setScale] = React.useState(initialScale)
  const [tx, setTx] = React.useState(0)
  const [ty, setTy] = React.useState(0)
  const [panning, setPanning] = React.useState<null | { sx: number; sy: number; tx0: number; ty0: number }>(null)

  const gTransform = `matrix(${scale},0,0,${scale},${tx},${ty})`

  function clientToWorld(e: React.MouseEvent) {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const ctm = (svg.getScreenCTM() as DOMMatrix).inverse()
    const p = pt.matrixTransform(ctm)
    const inv = 1 / scale
    return { x: (p.x - tx) * inv, y: (p.y - ty) * inv }
  }

  function onWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault()
    const factor = Math.exp(-e.deltaY * 0.0015)
    const ns = Math.max(0.2, Math.min(8, scale * factor))
    const rect = svgRef.current!.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const wx = (cx - tx) / scale
    const wy = (cy - ty) / scale
    setScale(ns)
    setTx(cx - wx * ns)
    setTy(cy - wy * ns)
  }

  function onMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    if (e.button !== 0 || !e.shiftKey) return
    setPanning({ sx: e.clientX, sy: e.clientY, tx0: tx, ty0: ty })
  }
  function onMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!panning) return
    setTx(panning.tx0 + (e.clientX - panning.sx))
    setTy(panning.ty0 + (e.clientY - panning.sy))
  }
  function onMouseUp() { setPanning(null) }

  return { svgRef, scale, tx, ty, gTransform, clientToWorld, onWheel, onMouseDown, onMouseMove, onMouseUp, panning }
}
