'use client'

import { useEffect, useRef, useState } from 'react'

export interface CanvasDimensionsHeaderLabels {
  width: string
  height: string
  metres: string
}

export interface CanvasDimensionsHeaderProps {
  width: number
  height: number
  labels: CanvasDimensionsHeaderLabels
  /** Called after the 600ms debounce with validated numeric values. */
  onSave: (width: number, height: number) => void
  /** Minimum (default 5m). Values below are clamped on blur. */
  min?: number
  /** Maximum (default 500m). */
  max?: number
}

// Raw utilities (shared package — no app `.input`/`accent`), aligned with .claude/rules/ui.md.
const NUM_INPUT =
  'w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900'

/**
 * Inline-debounced width/height inputs for the editor canvas. Sits in the
 * editor toolbar (e.g. via TableLayoutEditor's `toolbarRight`). Validates and
 * clamps to the given range before invoking onSave.
 */
export function CanvasDimensionsHeader({
  width,
  height,
  labels,
  onSave,
  min = 5,
  max = 500,
}: CanvasDimensionsHeaderProps) {
  const [w, setW] = useState(String(width))
  const [h, setH] = useState(String(height))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Re-sync when props change from the outside (e.g. after refresh).
  useEffect(() => {
    setW(String(width))
    setH(String(height))
  }, [width, height])

  const commit = (nextW: string, nextH: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const wn = Number(nextW)
      const hn = Number(nextH)
      if (!Number.isFinite(wn) || !Number.isFinite(hn)) return
      const clampedW = Math.max(min, Math.min(max, wn))
      const clampedH = Math.max(min, Math.min(max, hn))
      onSave(clampedW, clampedH)
    }, 600)
  }

  return (
    <div className="flex items-center gap-3 text-xs text-gray-600">
      <label className="flex items-center gap-1.5">
        <span>{labels.width}</span>
        <input
          type="number"
          min={min}
          max={max}
          value={w}
          onChange={(e) => {
            setW(e.target.value)
            commit(e.target.value, h)
          }}
          className={NUM_INPUT}
        />
        <span className="text-gray-400">{labels.metres}</span>
      </label>
      <label className="flex items-center gap-1.5">
        <span>{labels.height}</span>
        <input
          type="number"
          min={min}
          max={max}
          value={h}
          onChange={(e) => {
            setH(e.target.value)
            commit(w, e.target.value)
          }}
          className={NUM_INPUT}
        />
        <span className="text-gray-400">{labels.metres}</span>
      </label>
    </div>
  )
}
