/**
 * "Preview on map" UI state for assistant inventory proposals (track 030 S4b).
 *
 * The *content* of a preview is derived (latest proposed inventory_batch in the
 * conversation); this store keeps only the user's overrides, so Apply / Undo /
 * Reject clear the ghosts with no extra bookkeeping: the proposal's status leaves
 * 'proposed' and the derivation returns nothing. Module-level (like assistant-store)
 * so it survives the tab remount that every site route causes.
 */
import { GEOMETRY_KINDS, hasRemovals, parseGeometry, type GeometryPreview } from './geometry-preview'
import type { ProposalInfo } from './stream-reducer'

export interface PreviewUi {
  /** Card the user explicitly asked to see (overrides "latest"). */
  forcedId: string | null
  /** Cards the user hid; never auto-shown again. */
  hidden: string[]
  /** Phone: sheet closed to look at the map - show the "Back to proposal" chip. */
  peek: boolean
  /** Bumped on every explicit show so the editor re-fits even for the same card. */
  focusNonce: number
}

export const INITIAL_PREVIEW_UI: PreviewUi = { forcedId: null, hidden: [], peek: false, focusNonce: 0 }

export type PreviewUiAction =
  | { type: 'show'; actionId: string; peek?: boolean }
  | { type: 'hide'; actionId: string }
  | { type: 'peek'; value: boolean }
  | { type: 'reset' }

export function reducePreviewUi(ui: PreviewUi, a: PreviewUiAction): PreviewUi {
  switch (a.type) {
    case 'show':
      return {
        forcedId: a.actionId,
        hidden: ui.hidden.filter((id) => id !== a.actionId),
        peek: a.peek ?? false,
        focusNonce: ui.focusNonce + 1,
      }
    case 'hide':
      return {
        ...ui,
        forcedId: ui.forcedId === a.actionId ? null : ui.forcedId,
        hidden: ui.hidden.includes(a.actionId) ? ui.hidden : [...ui.hidden, a.actionId],
        peek: false,
      }
    case 'peek':
      return ui.peek === a.value ? ui : { ...ui, peek: a.value }
    case 'reset':
      return INITIAL_PREVIEW_UI
  }
}

export interface ActivePreview {
  actionId: string
  geometry: GeometryPreview
}

/** Which pending delete proposal should be drawn right now, or null. Pure. */
export function selectActivePreview(
  proposals: readonly Pick<ProposalInfo, 'actionId' | 'kind' | 'status' | 'preview'>[],
  ui: PreviewUi,
): ActivePreview | null {
  const candidates: ActivePreview[] = []
  for (const p of proposals) {
    if (!GEOMETRY_KINDS.includes(p.kind) || p.status !== 'proposed') continue
    const geometry = parseGeometry(p.preview)
    // Act-immediately: only a pending DELETE is still a proposal, and only that is ghosted (to show what would go).
    if (geometry && hasRemovals(geometry)) candidates.push({ actionId: p.actionId, geometry })
  }
  const forced = ui.forcedId ? candidates.find((c) => c.actionId === ui.forcedId) : undefined
  if (forced) return forced
  for (let i = candidates.length - 1; i >= 0; i--) {
    const c = candidates[i]!
    if (!ui.hidden.includes(c.actionId)) return c
  }
  return null
}

// ── module store ──────────────────────────────────────────────────────────
const uis = new Map<string, PreviewUi>()
const listeners = new Set<() => void>()

export function subscribePreview(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
export function getPreviewUi(siteId: string): PreviewUi {
  return uis.get(siteId) ?? INITIAL_PREVIEW_UI
}
export function dispatchPreview(siteId: string, action: PreviewUiAction): void {
  const prev = getPreviewUi(siteId)
  const next = reducePreviewUi(prev, action)
  if (next === prev) return
  uis.set(siteId, next)
  listeners.forEach((l) => l())
}
