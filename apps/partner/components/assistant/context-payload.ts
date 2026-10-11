/** Pure builder for the `context` field of `POST /api/assistant`. */

export interface AssistantSelection {
  itemIds?: string[]
  parcel?: number
  elementId?: string
}

export interface AssistantViewport {
  zoom?: number
  center?: { lat: number; lng: number }
}

export interface AssistantPageContext {
  tab?: string
  layoutMode?: 'geo' | 'schematic'
  selection?: AssistantSelection
  viewport?: AssistantViewport
}

/** A box-select on a 4,000-seat site must not balloon every request. */
export const MAX_CONTEXT_ITEM_IDS = 100

export function cleanSelection(sel: AssistantSelection | undefined): AssistantSelection | undefined {
  if (!sel) return undefined
  const out: AssistantSelection = {}
  if (sel.itemIds && sel.itemIds.length > 0) out.itemIds = sel.itemIds.slice(0, MAX_CONTEXT_ITEM_IDS)
  if (typeof sel.parcel === 'number' && Number.isFinite(sel.parcel)) out.parcel = sel.parcel
  if (sel.elementId) out.elementId = sel.elementId
  return Object.keys(out).length > 0 ? out : undefined
}

export function buildContextPayload(ctx: AssistantPageContext): AssistantPageContext {
  const out: AssistantPageContext = {}
  if (ctx.tab) out.tab = ctx.tab
  if (ctx.layoutMode) out.layoutMode = ctx.layoutMode
  const selection = cleanSelection(ctx.selection)
  if (selection) out.selection = selection
  if (ctx.viewport) out.viewport = ctx.viewport
  return out
}

/** i18n keys of the starter prompts offered for an empty conversation on a tab. */
export function starterKeys(tab: string | undefined): string[] {
  switch (tab) {
    case 'inventory':
      return ['inventory1', 'inventory2', 'inventory3']
    case 'schematic':
      return ['schematic1', 'schematic2', 'schematic3']
    case 'general':
      return ['general1', 'general2', 'general3']
    case 'products':
      return ['products1', 'products2', 'products3']
    case 'rentals':
      return ['rentals1', 'rentals2', 'rentals3']
    default:
      return ['default1', 'default2', 'default3']
  }
}
