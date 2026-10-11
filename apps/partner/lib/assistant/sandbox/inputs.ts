/**
 * What a run_js script gets to read (track 030 G4) — all of it scoped to the route-bound site.
 *
 *  - `data`: the `assistant.*` views (the same allowlisted, PII-free views the `sql` tool queries),
 *    read through `runAssistantSql` as the DB-enforced `assistant_reader` role -- Postgres, not this
 *    file, limits the rows to the claimed site. Table names come from the `sql-schema.ts` list,
 *    matched against the script text; the SELECT is built from that name only, never from model input.
 *  - `scene`: the G2 site scene in the local metre frame (x east, y north): parcels with corners,
 *    anchor and row bearing, schematic elements, and — when the script mentions them — every seat
 *    position and the shoreline.
 *  - `frame`: the constants the in-sandbox `geo.toLocal` / `geo.fromLocal` need.
 */
import { runAssistantSql } from '@repo/data/assistant-claim'
import prisma from '@repo/data/PrismaCient'
import { formatSeatId } from '@repo/data/seat-label'
import { M_PER_DEG, describeFrame, toLocal, type Frame, type Pt } from '../geo/frame'
import { elementPolygon } from '../geo/features'
import { centroid } from '../geo/shapes'
import { ASSISTANT_VIEWS, VIEW_NAMES, type AssistantViewName } from '../sql-schema'
import { elementHandle } from '../tools/helpers'
import { loadElements, seatLocal, type SiteBase } from '../tools/spatial-data'
import { shoreScene } from '../tools/spatial'
import type { SandboxFrame } from './run'

/** Rows per view handed to a script (newest first for reservations / orders / invoices). */
export const DATA_ROW_CAP = 5000
/** Seat positions in `scene.seats`. */
export const SCENE_SEAT_CAP = 5000
/** Shoreline radius around the site origin, metres. */
export const SCENE_SHORE_RADIUS_M = 600

const word = (name: string) => new RegExp(`\\b${name}\\b`)

/** Views the script names (a dynamic `data[x]` access loads them all). */
export function referencedTables(code: string): AssistantViewName[] {
  if (/\bdata\s*\[/.test(code)) return [...VIEW_NAMES]
  return VIEW_NAMES.filter((n) => word(n).test(code))
}

export const sceneWants = (code: string) => ({ seats: /\bseats\b/.test(code), shoreline: /shore/i.test(code) })

const jsonSafe = (v: unknown): unknown =>
  typeof v === 'bigint' ? Number(v) : v instanceof Date ? v.toISOString() : v instanceof Uint8Array ? null : v

/** Newest-first ordering for the tables that can exceed the cap; the rest read in view order. */
const ORDER: Partial<Record<AssistantViewName, string>> = {
  reservation: ' ORDER BY created_at DESC',
  food_order: ' ORDER BY created_at DESC',
  invoice: ' ORDER BY invoiced_at DESC',
}

/**
 * Read the named views for the claimed site as plain row objects, capped. `siteId` / `accountId`
 * are the route-bound ids (never model input); the database enforces that nothing else is visible.
 * A failing view is reported in `notes` and left out rather than failing the whole script.
 */
export async function readAssistantTables(siteId: string, accountId: string, tables: readonly AssistantViewName[], cap = DATA_ROW_CAP) {
  const data: Record<string, Record<string, unknown>[]> = {}
  const truncated: Record<string, { loaded: number; total: number }> = {}
  const notes: string[] = []
  const ctx = { siteId, accountId, maxRows: cap }
  for (const name of tables) {
    if (!ASSISTANT_VIEWS.some((v) => v.name === name)) continue
    try {
      const res = await runAssistantSql(`SELECT * FROM assistant.${name}${ORDER[name] ?? ''} LIMIT ${cap}`, [], ctx)
      data[name] = res.rows.map((r) => Object.fromEntries(res.columns.map((col, i) => [col, jsonSafe(r[i])])))
      if (res.truncated || res.rows.length >= cap) {
        const n = await runAssistantSql(`SELECT count(*) AS n FROM assistant.${name}`, [], { siteId, accountId, maxRows: 1 })
        const total = Number(n.rows[0]?.[0] ?? cap)
        if (total > cap) truncated[name] = { loaded: cap, total }
      }
    } catch (err) {
      data[name] = []
      notes.push(`data.${name} could not be read (${(err instanceof Error ? err.message : String(err)).split('\n')[0]!.slice(0, 120)}); it is empty`)
    }
  }
  return { data, truncated, notes }
}

export function sandboxFrame(frame: Frame): SandboxFrame {
  return frame.mode === 'geo' ? { mode: 'geo', origin: frame.origin, perLng: frame.perLng, mPerDeg: M_PER_DEG } : { mode: 'schematic' }
}

const r3 = (v: number) => Math.round(v * 1000) / 1000 + 0
const rp = (p: Pt): Pt => ({ x: r3(p.x), y: r3(p.y) })

/** The site scene in local metres. `want` decides the two optional (heavier) parts. */
export async function buildScriptScene(siteId: string, base: SiteBase, want: { seats: boolean; shoreline: boolean }) {
  const notes: string[] = []
  const parcels = base.parcels.map((p) => {
    const anchor = toLocal(base.frame, p.shape.anchor as never)
    return {
      number: p.summary.group,
      corners: p.poly.map(rp),
      centre: rp(centroid(p.poly)),
      anchor: anchor ? rp(anchor) : null,
      rowBearingDegrees: r3(p.shape.rowBearingDegrees),
      alongRowsM: r3(p.shape.sizeM.alongRows),
      acrossRowsM: r3(p.shape.sizeM.acrossRows),
      seatCount: p.summary.count,
      rows: p.summary.rows,
      seatsPerRow: p.summary.seatsPerRow,
      horizontalGapM: p.summary.horizontalGap,
      verticalGapM: p.summary.verticalGap,
      rotation: p.summary.rotation,
      category: p.summary.category,
      price: p.summary.price,
    }
  })
  if (base.parcelsWithoutGeometry.length) notes.push(`parcels without a position (not in scene.parcels): ${base.parcelsWithoutGeometry.join(', ')}`)

  let elements: unknown[] = []
  if (base.mode === 'schematic') {
    const rows = await loadElements(siteId)
    elements = rows.map((e) => {
      const corners = elementPolygon(e).map((q) => ({ x: q.x, y: q.y }))
      return { element: elementHandle(e.id), type: e.type, label: e.label, corners: corners.map(rp), centre: rp(centroid(corners)), width: e.width, height: e.height, rotation: e.rotation }
    })
  }

  let seats: unknown[] | undefined
  if (want.seats) {
    const rows = await prisma.inventoryItem.findMany({
      where: { siteId, status: { not: 'pool' } },
      select: { number: true, seatLabel: true, group: true, status: true, rotation: true, locationLat: true, locationLng: true, schematicX: true, schematicY: true },
      orderBy: { number: 'asc' },
      take: SCENE_SEAT_CAP + 1,
    })
    if (rows.length > SCENE_SEAT_CAP) notes.push(`scene.seats holds the first ${SCENE_SEAT_CAP} seats only`)
    seats = rows.slice(0, SCENE_SEAT_CAP).flatMap((s) => {
      const at = seatLocal(base.frame, s)
      if (!at) return []
      return [{ id: s.seatLabel ? formatSeatId({ seatLabel: s.seatLabel, number: s.number }) : `#${s.number}`, parcel: s.group, at: rp(at), rotation: s.rotation, status: s.status }]
    })
  }

  let shoreline: unknown = undefined
  if (want.shoreline) {
    if (base.mode === 'geo' && base.origin) {
      const shore = await shoreScene(base.origin, base.frame, SCENE_SHORE_RADIUS_M, notes)
      shoreline = shore
        ? { lines: shore.lines.map((l) => l.map(rp)), water: shore.water.map((w) => w.map(rp)), seaBearingDegrees: shore.seaBearingDegrees }
        : null
    } else {
      shoreline = null
      notes.push('schematic site: no shoreline; water is an element (type "water") in scene.elements')
    }
  }

  return {
    frame: describeFrame(base.frame),
    parcels,
    elements,
    ...(seats ? { seats } : {}),
    ...(shoreline !== undefined ? { shoreline } : {}),
    notes,
  }
}
