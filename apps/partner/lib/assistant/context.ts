/**
 * The per-turn page context (track 030 S2): what the user is looking at, sent by the client and
 * attached to the USER message (after the cached prefix). The client is untrusted: the shape is
 * sanitised and every id is resolved against the authenticated site, so a foreign id is dropped
 * and a cuid never reaches the model.
 */
import prisma from '@repo/data/PrismaCient'
import { formatSeatId } from '@repo/data/seat-label'
import { elementHandle } from './tools/helpers'

export interface ClientContext {
  tab?: string
  layoutMode?: 'geo' | 'schematic'
  selection?: { itemIds?: string[]; parcel?: number; elementId?: string }
  viewport?: { zoom?: number; center?: { lat: number; lng: number } }
}

const MAX_SELECTED_IDS = 100
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export const CONTEXT_OPEN = '<page_context>'
export const CONTEXT_CLOSE = '</page_context>'

/** Never throws; unknown shapes become an empty context. */
export function parseClientContext(raw: unknown): ClientContext {
  if (!isObj(raw)) return {}
  const out: ClientContext = {}
  if (typeof raw.tab === 'string' && /^[a-z][a-z-]{0,39}$/.test(raw.tab)) out.tab = raw.tab
  if (raw.layoutMode === 'geo' || raw.layoutMode === 'schematic') out.layoutMode = raw.layoutMode
  if (isObj(raw.selection)) {
    const s = raw.selection
    const selection: NonNullable<ClientContext['selection']> = {}
    if (Array.isArray(s.itemIds)) {
      selection.itemIds = s.itemIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 40).slice(0, MAX_SELECTED_IDS)
    }
    if (finite(s.parcel) && Number.isInteger(s.parcel) && s.parcel >= 1 && s.parcel <= 9999) selection.parcel = s.parcel
    if (typeof s.elementId === 'string' && s.elementId.length > 0 && s.elementId.length <= 40) selection.elementId = s.elementId
    if (Object.keys(selection).length) out.selection = selection
  }
  if (isObj(raw.viewport)) {
    const v = raw.viewport
    const viewport: NonNullable<ClientContext['viewport']> = {}
    if (finite(v.zoom) && v.zoom >= 0 && v.zoom <= 30) viewport.zoom = Math.round(v.zoom * 10) / 10
    if (isObj(v.center) && finite(v.center.lat) && finite(v.center.lng) && Math.abs(v.center.lat) <= 90 && Math.abs(v.center.lng) <= 180) {
      viewport.center = { lat: Math.round(v.center.lat * 1e4) / 1e4, lng: Math.round(v.center.lng * 1e4) / 1e4 }
    }
    if (Object.keys(viewport).length) out.viewport = viewport
  }
  return out
}

/**
 * The `<page_context>` block for the model, or '' when there is nothing to say. Ids are resolved
 * WITHIN `siteId`; the model sees seat ids ("1-2-3-1"), parcel numbers and element handles only.
 */
export async function renderPageContext(
  context: ClientContext,
  siteId: string,
  /** The files attached to THIS message (verified server-side), so the model can name them in `propose_place_image`. */
  attachments: readonly { id: string; name: string; kind: string }[] = [],
): Promise<string> {
  const body: Record<string, unknown> = {}
  if (attachments.length) body.attachments = attachments.map((a) => ({ uploadId: a.id, name: a.name, kind: a.kind }))
  if (context.tab) body.tab = context.tab
  if (context.layoutMode) body.layoutMode = context.layoutMode

  const sel = context.selection
  if (sel) {
    const selection: Record<string, unknown> = {}
    if (sel.itemIds?.length) {
      const seats = await prisma.inventoryItem.findMany({
        where: { id: { in: sel.itemIds }, siteId },
        select: { number: true, seatLabel: true },
        orderBy: { number: 'asc' },
        take: MAX_SELECTED_IDS,
      })
      if (seats.length) {
        selection.seatCount = seats.length
        selection.seats = seats.slice(0, 20).map((s) => formatSeatId(s))
      }
    }
    if (sel.parcel !== undefined) {
      const exists = await prisma.inventoryItem.count({ where: { siteId, group: sel.parcel } })
      if (exists > 0) selection.parcel = sel.parcel
    }
    if (sel.elementId) {
      const el = await prisma.layoutElement.findFirst({ where: { id: sel.elementId, siteId }, select: { id: true, type: true, label: true } })
      if (el) selection.element = { element: elementHandle(el.id), type: el.type, label: el.label }
    }
    if (Object.keys(selection).length) body.selection = selection
  }
  if (context.viewport) body.viewport = context.viewport

  if (Object.keys(body).length === 0) return ''
  return `${CONTEXT_OPEN}${JSON.stringify(body)}${CONTEXT_CLOSE}`
}
