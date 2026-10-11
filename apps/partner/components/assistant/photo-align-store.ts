'use client'

/**
 * Alignment-mode state for an aerial photo (track 030 S7d). Module-level per site (like
 * assistant-store / preview-store) so it survives the tab remount every site route causes: the
 * `align_photo` event can arrive while the user is on another tab, and the mode is waiting when
 * they navigate to inventory.
 *
 * `reduceAlign` is pure; the functions below it own the I/O (extract POST + polling).
 */
import type { ImageSize, SimilarityGeoref } from '@repo/agent/geo/georef'
import { pollExtract, postExtract, type ExtractStatus } from './aerial-api'
import { clampOpacity, DEFAULT_OPACITY, INITIAL_PINS, reducePins, type PinAction, type PinState } from './photo-align'

export interface AlignRequest {
  uploadId: string
  seed: SimilarityGeoref
  image: ImageSize
}

export type ExtractUi = 'idle' | ExtractStatus
export type SaveUi = 'idle' | 'saving' | 'error'

export interface AlignState {
  request: AlignRequest | null
  /** Alignment mode is open (the layer + toolbar render on the inventory map). */
  active: boolean
  georef: SimilarityGeoref | null
  opacity: number
  pins: PinState
  extract: ExtractUi
  save: SaveUi
}

export const INITIAL_ALIGN: AlignState = {
  request: null,
  active: false,
  georef: null,
  opacity: DEFAULT_OPACITY,
  pins: INITIAL_PINS,
  extract: 'idle',
  save: 'idle',
}

export type AlignAction =
  | { type: 'open'; request: AlignRequest }
  | { type: 'close' }
  | { type: 'set_georef'; georef: SimilarityGeoref }
  | { type: 'reset' }
  | { type: 'opacity'; value: number }
  | { type: 'pin'; action: PinAction }
  | { type: 'extract'; status: ExtractUi }
  | { type: 'save'; status: SaveUi }

export function reduceAlign(s: AlignState, a: AlignAction): AlignState {
  switch (a.type) {
    case 'open': {
      // Re-opening the same photo keeps the user's adjustments and the extraction progress.
      if (s.request?.uploadId === a.request.uploadId) return s.active ? s : { ...s, active: true, save: 'idle' }
      return { ...INITIAL_ALIGN, request: a.request, active: true, georef: a.request.seed }
    }
    case 'close':
      return s.active || s.pins.step !== 'idle' ? { ...s, active: false, pins: INITIAL_PINS, save: 'idle' } : s
    case 'set_georef':
      return s.request ? { ...s, georef: a.georef } : s
    case 'reset':
      return s.request ? { ...s, georef: s.request.seed, pins: INITIAL_PINS } : s
    case 'opacity': {
      const opacity = clampOpacity(a.value)
      return opacity === s.opacity ? s : { ...s, opacity }
    }
    case 'pin': {
      if (!s.request) return s
      const pins = reducePins(s.pins, a.action)
      if (pins === s.pins) return s
      // A finished pair becomes the new georef; the flow is idle again.
      if (pins.result) return { ...s, georef: pins.result, pins: INITIAL_PINS }
      return { ...s, pins }
    }
    case 'extract':
      return s.extract === a.status ? s : { ...s, extract: a.status }
    case 'save':
      return s.save === a.status ? s : { ...s, save: a.status }
  }
}

// ── module store ──────────────────────────────────────────────────────────
const states = new Map<string, AlignState>()
const listeners = new Set<() => void>()
const runs = new Map<string, number>()

export function subscribeAlign(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
export function getAlign(siteId: string): AlignState {
  return states.get(siteId) ?? INITIAL_ALIGN
}
export function dispatchAlign(siteId: string, action: AlignAction): void {
  const prev = getAlign(siteId)
  const next = reduceAlign(prev, action)
  if (next === prev) return
  states.set(siteId, next)
  listeners.forEach((l) => l())
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Fires the (idempotent) extract POST and tracks its status. Safe to call again as "retry". */
export async function startExtract(siteId: string): Promise<void> {
  const req = getAlign(siteId).request
  if (!req) return
  const run = (runs.get(siteId) ?? 0) + 1
  runs.set(siteId, run)
  dispatchAlign(siteId, { type: 'extract', status: 'running' })
  const result = await pollExtract({
    post: () => postExtract(req.uploadId),
    sleep,
    isCancelled: () => runs.get(siteId) !== run || getAlign(siteId).request?.uploadId !== req.uploadId,
  })
  if (result) dispatchAlign(siteId, { type: 'extract', status: result })
}

/**
 * Entry point for the `align_photo` event and the transcript chip: opens the mode and kicks off
 * extraction right away unless this photo is already being / has been read.
 */
export function openAlign(siteId: string, request: AlignRequest): void {
  dispatchAlign(siteId, { type: 'open', request })
  const s = getAlign(siteId)
  if (s.extract === 'idle' || s.extract === 'failed') void startExtract(siteId)
}

export function closeAlign(siteId: string): void {
  dispatchAlign(siteId, { type: 'close' })
}
