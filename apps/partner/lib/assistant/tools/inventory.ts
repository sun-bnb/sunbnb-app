import prisma from '@repo/data/PrismaCient'
import { formatSeatId } from '@repo/data/seat-label'
import { getParcelSummaries, type ParcelSummary } from '@/app/sites/[id]/parcels'
import { siteLayoutMode } from '../proposals/inventory-sim'
import { measureParcels, positionFacts, type LayoutMode } from './parcel-geometry'
import { capList, defineTool, elementHandle, MAX_LIST, round2, storedSeatLabel } from './helpers'

const SEAT_STATUSES = ['active', 'disabled', 'new'] as const

type StatusRow = { group: number; status: string; _count: { _all: number } }

function breakdownByParcel(rows: StatusRow[]): Map<number, Record<string, number>> {
  const out = new Map<number, Record<string, number>>()
  for (const r of rows) {
    const entry = out.get(r.group) ?? {}
    entry[r.status] = (entry[r.status] ?? 0) + r._count._all
    out.set(r.group, entry)
  }
  return out
}

const parcelFacts = (p: ParcelSummary, mode: LayoutMode, compact: boolean) => ({
  parcel: p.group,
  seats: p.count,
  rows: p.rows,
  seatsPerRow: p.seatsPerRow,
  rotationDegrees: p.rotation,
  gapsMetres: p.itemGroupId
    ? { betweenSeats: p.horizontalGap, betweenRows: p.verticalGap, betweenPairedBeds: p.pairGap }
    : null,
  category: p.category,
  price: p.price,
  // Where it sits (map: lat/lng, schematic: x/y metres; sizes in metres) -- what relative moves need.
  position: positionFacts(p, mode, compact),
})

export const listParcels = defineTool({
  name: 'list_parcels',
  label: 'Reading parcels',
  description:
    'All parcels (blocks of sunbeds) of the open site: parcel number, seat count, rows, seats per row, rotation, gaps, category/price, position (centre, size in metres, row bearing) and a status breakdown (active/disabled/new). Also the count of sunbeds that belong to no parcel.',
  async run(_input, ctx) {
    const [summary, mode, statusRows] = await Promise.all([
      getParcelSummaries(ctx.siteId),
      siteLayoutMode(ctx.siteId),
      prisma.inventoryItem.groupBy({
        by: ['group', 'status'],
        where: { siteId: ctx.siteId, group: { gt: 0 }, status: { not: 'pool' } },
        _count: { _all: true },
      }),
    ])
    const byParcel = breakdownByParcel(statusRows as StatusRow[])
    const { rows, truncated, total } = capList(summary.parcels, 100)
    return {
      total,
      truncated,
      ungroupedSeats: summary.ungroupedCount,
      parcels: rows.map((p) => ({ ...parcelFacts(p, mode, true), statuses: byParcel.get(p.group) ?? {} })),
    }
  },
})

export const getParcel = defineTool({
  name: 'get_parcel',
  label: 'Reading a parcel',
  description:
    'Details of one parcel by its number: grid size, rotation, position (anchor, centre, footprint size in metres, row bearing, the 4 corners), gaps, price, status breakdown, number of units (spots) and pairs, first/last seat id and seats with a custom label or price.',
  properties: { parcel: { type: 'integer', minimum: 1, maximum: 9999, description: 'The parcel number as shown on the map' } },
  required: ['parcel'],
  async run(input, ctx) {
    const number = input.parcel as number
    const [{ parcels }, mode] = await Promise.all([getParcelSummaries(ctx.siteId), siteLayoutMode(ctx.siteId)])
    const summary = parcels.find((p) => p.group === number)
    if (!summary) return { ok: false, error: 'parcel_not_found' }

    const seats = await prisma.inventoryItem.findMany({
      where: { siteId: ctx.siteId, group: number, status: { not: 'pool' } },
      select: { number: true, seatLabel: true, status: true, sunbedGroupId: true, label: true, price: true },
      orderBy: { number: 'asc' },
      take: 2000,
    })
    const statuses: Record<string, number> = {}
    const unitSizes = new Map<string, number>()
    for (const s of seats) {
      statuses[s.status] = (statuses[s.status] ?? 0) + 1
      if (s.sunbedGroupId) unitSizes.set(s.sunbedGroupId, (unitSizes.get(s.sunbedGroupId) ?? 0) + 1)
    }
    const labelled = seats.filter((s) => s.label)
    const priced = seats.filter((s) => s.price != null)
    const first = seats[0]
    const last = seats[seats.length - 1]
    return {
      ...parcelFacts(summary, mode, false),
      statuses,
      units: unitSizes.size,
      pairedUnits: [...unitSizes.values()].filter((n) => n > 1).length,
      firstSeat: first ? formatSeatId(first) : null,
      lastSeat: last ? formatSeatId(last) : null,
      labelledSeats: labelled.slice(0, 20).map((s) => ({ seat: formatSeatId(s), label: s.label })),
      seatsWithOwnPrice: priced.length,
    }
  },
})

export const measureParcelsTool = defineTool({
  name: 'measure_parcels',
  label: 'Measuring parcels',
  description:
    'Relate two parcels: centre-to-centre distance and bearing, the edge-to-edge gap in metres (negative = overlapping), the unit direction from `from` to `to` ({ dx east, dy north }) and `by_m` -- the exact move for `from` (pass it to propose_move) that makes the edge gap `target_gap_m` (default 2) along the line between the centres. Use for "move parcel 5 closer to parcel 4", "2 m from parcel 3", "next to". Never ask the user for coordinates.',
  properties: {
    from: { type: 'integer', minimum: 1, maximum: 9999, description: 'The parcel that would move' },
    to: { type: 'integer', minimum: 1, maximum: 9999, description: 'The parcel to measure against' },
    target_gap_m: { type: 'number', minimum: 0, maximum: 1000, description: 'Wanted edge-to-edge gap in metres; default 2' },
  },
  required: ['from', 'to'],
  async run(input, ctx) {
    const [{ parcels }, mode] = await Promise.all([getParcelSummaries(ctx.siteId), siteLayoutMode(ctx.siteId)])
    const a = parcels.find((p) => p.group === input.from)
    const b = parcels.find((p) => p.group === input.to)
    if (!a || !b) return { ok: false, error: 'parcel_not_found' }
    if (a.group === b.group) return { ok: false, error: 'give two different parcels' }
    const target = typeof input.target_gap_m === 'number' ? input.target_gap_m : 2
    const m = measureParcels(a, b, mode, target)
    return m.ok ? { from: a.group, to: b.group, ...m } : m
  },
})

export const findSeats = defineTool({
  name: 'find_seats',
  label: 'Searching sunbeds',
  description:
    'Search sunbeds of the open site. `query` is a seat id like "1-2-3-1" (parcel-row-unit-member), a unit address "1-2-3", or text matching a custom seat label. Optional filters: parcel number and status. Returns at most 50 seats.',
  properties: {
    query: { type: 'string', maxLength: 60 },
    status: { type: 'string', enum: [...SEAT_STATUSES] },
    parcel: { type: 'integer', minimum: 1, maximum: 9999 },
    limit: { type: 'integer', minimum: 1, maximum: MAX_LIST },
  },
  async run(input, ctx) {
    const where: Record<string, unknown> = { siteId: ctx.siteId, status: { not: 'pool' } }
    if (typeof input.status === 'string') where.status = input.status
    if (typeof input.parcel === 'number') where.group = input.parcel
    const query = typeof input.query === 'string' ? input.query.trim() : ''
    if (query) {
      const stored = storedSeatLabel(query)
      if (stored) where.seatLabel = stored.label.endsWith('-') ? { startsWith: stored.label } : stored.label
      else where.label = { contains: query, mode: 'insensitive' }
    }
    const limit = typeof input.limit === 'number' ? input.limit : 25
    const [total, seats] = await Promise.all([
      prisma.inventoryItem.count({ where }),
      prisma.inventoryItem.findMany({
        where,
        select: { number: true, seatLabel: true, status: true, group: true, label: true, price: true, category: true },
        orderBy: { number: 'asc' },
        take: limit,
      }),
    ])
    return {
      total,
      truncated: total > seats.length,
      seats: seats.map((s) => ({
        seat: formatSeatId(s),
        parcel: s.group || null,
        status: s.status,
        label: s.label,
        price: s.price,
        category: s.category,
      })),
    }
  },
})

export const listLayoutElements = defineTool({
  name: 'list_layout_elements',
  label: 'Reading the schematic',
  description:
    'Schematic-layout elements (water, sand, grass, deck, pool, bar, reception, shower, restroom) of the open site, with a short element handle, type, shape, label, position and size in metres. Optional filters: type or one element handle. Empty for map-mode sites.',
  properties: {
    type: { type: 'string', maxLength: 50 },
    element: { type: 'string', minLength: 3, maxLength: 12, description: 'An element handle from a previous result' },
  },
  async run(input, ctx) {
    const where: Record<string, unknown> = { siteId: ctx.siteId }
    if (typeof input.type === 'string' && input.type) where.type = input.type
    const [site, elements] = await Promise.all([
      prisma.site.findUnique({ where: { id: ctx.siteId }, select: { layoutMode: true } }),
      prisma.layoutElement.findMany({ where, orderBy: [{ z: 'asc' }, { createdAt: 'asc' }], take: 500 }),
    ])
    let rows = elements
    if (typeof input.element === 'string' && input.element) {
      rows = elements.filter((e) => elementHandle(e.id) === input.element)
      if (rows.length === 0) return { ok: false, error: 'element_not_found' }
    }
    const { rows: shown, truncated, total } = capList(rows)
    return {
      layoutMode: site?.layoutMode ?? 'geo',
      total,
      truncated,
      elements: shown.map((e) => ({
        element: elementHandle(e.id),
        type: e.type,
        shape: e.shape,
        label: e.label,
        x: round2(e.x),
        y: round2(e.y),
        width: round2(e.width),
        height: round2(e.height),
        rotation: round2(e.rotation),
        layer: e.z,
      })),
    }
  },
})

/**
 * Ask the UI to open the existing QR print flow for a parcel or some sunbeds. Changes nothing, so it
 * is not a proposal: it returns the target and emits the `qr_print` SSE event
 * `{ parcel?: number, seatLabels?: string[], seatIds?: string[] }` (`seatLabels` are the STORED labels,
 * matching `InventoryItem.seatLabel` on the client; `seatIds` the display form "1-2-3-1").
 */
export const requestQrPrint = defineTool({
  name: 'request_qr_print',
  label: 'Preparing QR cards',
  description:
    'Open the QR-card print dialog for a parcel ({ parcel: n }) or specific sunbeds ({ seats: ["1-2-3-1"] }). Use after a change that renumbered sunbeds (the proposal warned that QR cards need reprinting). It only opens the print dialog for the user; it prints nothing by itself.',
  properties: {
    target: {
      type: 'object',
      properties: {
        parcel: { type: 'integer', minimum: 1, maximum: 9999 },
        seats: { type: 'array', items: { type: 'string', maxLength: 30 }, minItems: 1, maxItems: 200 },
      },
      additionalProperties: false,
    },
  },
  required: ['target'],
  async run(input, ctx) {
    const t = (input.target ?? {}) as { parcel?: unknown; seats?: unknown }
    if ((t.parcel === undefined) === (t.seats === undefined)) return { ok: false, error: 'give exactly one of parcel or seats' }
    if (t.parcel !== undefined) {
      if (!Number.isInteger(t.parcel) || (t.parcel as number) < 1) return { ok: false, error: 'parcel must be a parcel number' }
      const n = await prisma.inventoryItem.count({ where: { siteId: ctx.siteId, group: t.parcel as number, status: { not: 'pool' } } })
      if (n === 0) return { ok: false, error: 'parcel_not_found' }
      ctx.emit?.('qr_print', { parcel: t.parcel })
      return { ok: true, printTarget: { parcel: t.parcel }, instruction: 'The print dialog is opening for the user. Do not say it was printed.' }
    }
    if (!Array.isArray(t.seats) || t.seats.length === 0 || t.seats.length > 200 || t.seats.some((s) => typeof s !== 'string')) return { ok: false, error: 'seats must be a list of sunbed ids like "1-2-3-1"' }
    const wanted: Array<{ label: string; prefix: boolean }> = []
    for (const raw of t.seats as string[]) {
      const stored = storedSeatLabel(raw)
      if (!stored) return { ok: false, error: `"${raw}" is not a sunbed id (parcel-row-unit-member)` }
      wanted.push({ label: stored.label, prefix: stored.label.endsWith('-') })
    }
    const rows = await prisma.inventoryItem.findMany({
      where: {
        siteId: ctx.siteId,
        status: { not: 'pool' },
        OR: wanted.map((w) => (w.prefix ? { seatLabel: { startsWith: w.label } } : { seatLabel: w.label })),
      },
      select: { number: true, seatLabel: true },
      orderBy: { number: 'asc' },
      take: 400,
    })
    if (rows.length === 0) return { ok: false, error: 'seats_not_found' }
    const seatLabels = rows.map((r) => r.seatLabel).filter((l): l is string => !!l)
    const seatIds = rows.map((r) => formatSeatId(r))
    ctx.emit?.('qr_print', { seatLabels, seatIds })
    return { ok: true, printTarget: { seatIds }, instruction: 'The print dialog is opening for the user. Do not say it was printed.' }
  },
})
