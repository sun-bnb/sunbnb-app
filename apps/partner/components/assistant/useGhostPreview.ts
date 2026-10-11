'use client'

import { useMemo, useSyncExternalStore } from 'react'
import * as assistant from './assistant-store'
import { INITIAL_STATE } from './stream-reducer'
import { buildGhostModel, type GhostModel, type GeometryMode, type SeatLookup } from './geometry-preview'
import { getPreviewUi, INITIAL_PREVIEW_UI, selectActivePreview, subscribePreview, type ActivePreview } from './preview-store'

/** The preview selected for this site (any mode), re-evaluated on store changes. */
export function useActivePreview(siteId: string): { active: ActivePreview | null; focusNonce: number; peek: boolean } {
  const state = useSyncExternalStore(assistant.subscribe, () => assistant.getState(siteId), () => INITIAL_STATE)
  const ui = useSyncExternalStore(subscribePreview, () => getPreviewUi(siteId), () => INITIAL_PREVIEW_UI)
  const proposals = useMemo(() => state.messages.flatMap((m) => m.proposals), [state.messages])
  const active = useMemo(() => selectActivePreview(proposals, ui), [proposals, ui])
  return { active, focusNonce: ui.focusNonce, peek: ui.peek }
}

/**
 * For an editor: the ghost model to paint, only when the preview's mode matches the editor
 * (a geo preview is not drawn on the schematic and vice versa). `focusKey` changes when the
 * editor should (re)fit the viewport: a different card activated, or an explicit "show".
 */
export function useGhostPreview(
  siteId: string,
  mode: GeometryMode,
  lookup: SeatLookup,
): { model: GhostModel | null; focusKey: string } {
  const { active, focusNonce } = useActivePreview(siteId)
  const geo = active && active.geometry.mode === mode ? active : null
  const model = useMemo(() => (geo ? buildGhostModel(geo.geometry, lookup) : null), [geo, lookup])
  return { model, focusKey: geo ? `${geo.actionId}:${focusNonce}` : '' }
}
