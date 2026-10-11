/**
 * describe_site_area + measure (track 030 G2): the scene the model reasons over and the generic
 * two-feature measurement. Overpass (fetch) and the coastline lookup are mocked; every lookup must be
 * scoped to the route-bound site.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('@repo/data/flags', () => ({ getFlagStates: vi.fn() }))
vi.mock('@/app/sites/[id]/parcels', () => ({ getParcelSummaries: vi.fn() }))
vi.mock('@repo/data/coastline-lookup', () => ({ shoreAround: vi.fn() }))
vi.mock('@/app/sites/[id]/item-counts', () => ({ getSiteItemCounts: vi.fn() }))

import { executeToolCall } from '@repo/agent/loop'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { shoreAround } from '@repo/data/coastline-lookup'
import { getParcelSummaries } from '@/app/sites/[id]/parcels'
import { getAssistantTools, type AssistantToolCtx } from './index'
import { resetOsmCache } from './osm-source'

const OWNER = 'owner-1'
const SITE = 'site-1'
const OTHER = 'site-2'
const ctx: AssistantToolCtx = { session: {}, accountId: OWNER, siteId: SITE, locale: 'en' }
const tools = getAssistantTools()
const M = 111320
const ORIGIN = { lat: 39.8335, lng: 3.1212 }
const perLng = M * Math.cos((ORIGIN.lat * Math.PI) / 180)
const at = (east: number, north: number) => ({ lat: ORIGIN.lat + north / M, lng: ORIGIN.lng + east / perLng })

async function call(name: string, input: Record<string, unknown> = {}, c: AssistantToolCtx = ctx) {
  return executeToolCall(tools, { id: 't1', name, arguments: JSON.stringify(input) }, c)
}
async function result(name: string, input: Record<string, unknown> = {}, c: AssistantToolCtx = ctx) {
  const ex = await call(name, input, c)
  expect(ex.errors).toEqual([])
  return ex.result as Record<string, any>
}

/** A 1x1 parcel is a 2.1 m square around its anchor; the anchor is `east`/`north` metres from ORIGIN. */
const geoParcel = (group: number, east: number, north: number, over: Record<string, unknown> = {}) => ({
  group, count: 1, itemGroupId: `ig${group}`, rows: 1, seatsPerRow: 1, horizontalGap: 1, verticalGap: 1.5, pairGap: 0, rotation: 0,
  locationLat: String(at(east, north).lat), locationLng: String(at(east, north).lng), schematicX: null, schematicY: null,
  category: 'PRICE1', price: 9, ...over,
})
const schParcel = (group: number, x: number, y: number) => ({
  group, count: 1, itemGroupId: `ig${group}`, rows: 1, seatsPerRow: 1, horizontalGap: 1, verticalGap: 1.5, pairGap: 0, rotation: 0,
  locationLat: null, locationLng: null, schematicX: x, schematicY: y, category: 'PRICE1', price: 9,
})

const g = (...c: Array<{ lat: number; lng: number }>) => c.map((p) => ({ lat: p.lat, lon: p.lng }))
const overpassAnswer = {
  elements: [
    { type: 'way', id: 1, tags: { highway: 'residential', name: 'Calle Mar' }, geometry: g(at(-100, 20), at(100, 20)) }, // 20 m north of the origin
    { type: 'node', id: 7, ...(() => { const p = at(15, 0); return { lat: p.lat, lon: p.lng } })(), tags: { amenity: 'toilets' } },
    { type: 'way', id: 3, tags: { highway: 'pedestrian', name: 'Paseo Marítimo' }, geometry: g(at(-100, -30), at(100, -30)) },
  ],
}
const okFetch = () => vi.fn().mockResolvedValue({ ok: true, json: async () => overpassAnswer })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.clearAllMocks()
  resetOsmCache()
  fetchMock = okFetch()
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(auth).mockResolvedValue({ user: { id: OWNER } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as never)
  vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER, layoutMode: 'geo', locationLat: String(ORIGIN.lat), locationLng: String(ORIGIN.lng) } as never)
  vi.mocked(getParcelSummaries).mockResolvedValue({ parcels: [geoParcel(4, 0, 0), geoParcel(5, 30, 0)], ungroupedCount: 0 })
  vi.mocked(prisma.inventoryItem.count).mockResolvedValue(0 as never)
  vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.layoutElement.findMany).mockResolvedValue([] as never)
  // sea to the EAST, 60 m from the origin (water on the right of a northbound way)
  vi.mocked(shoreAround).mockResolvedValue({ ways: [[at(60, -500), at(60, 500)]], water: [] } as never)
})
afterEach(() => vi.unstubAllGlobals())

describe('describe_site_area (map site)', () => {
  it('returns the frame, parcels, shoreline with the sea bearing, and OSM features with ids', async () => {
    const r = await result('describe_site_area')
    expect(r.frame).toMatchObject({ mode: 'geo', origin: { lat: ORIGIN.lat, lng: ORIGIN.lng } })
    expect(r.parcels.map((p: any) => p.parcel)).toEqual([4, 5])
    expect(r.parcels[0].centre[0]).toBeCloseTo(0, 0)
    expect(r.parcels[1].centre[0]).toBeCloseTo(30, 0)
    expect(r.parcels[0].corners).toHaveLength(4)
    expect(r.shoreline.sea_bearing_from_origin_deg).toBe(90)
    expect(r.shoreline.distance_origin_to_waterline_m).toBeCloseTo(60, 0)
    const byId = Object.fromEntries(r.osm.features.map((f: any) => [f.id, f]))
    expect(byId.w1).toMatchObject({ kind: 'road', type: 'residential', name: 'Calle Mar' })
    expect(byId.w1.dist_m).toBeCloseTo(20, 0)
    expect(byId.n7).toMatchObject({ kind: 'poi', type: 'toilets' })
    expect(byId.n7.at[0]).toBeCloseTo(15, 0)
    expect(byId.w3.kind).toBe('promenade')
    expect(shoreAround).toHaveBeenCalledWith(ORIGIN.lat, ORIGIN.lng, 300)
    expect(fetchMock.mock.calls[0]![1].body).toContain(`around%3A300%2C${ORIGIN.lat.toFixed(6)}`)
  })

  it('the scene stays compact: well under the budget for a normal beach', async () => {
    const r = await call('describe_site_area')
    expect(JSON.stringify(r.result).length).toBeLessThan(6000)
  })

  it('Overpass timing out degrades gracefully: the scene comes back WITHOUT osm and says so', async () => {
    fetchMock.mockRejectedValue(new DOMException('timeout', 'TimeoutError'))
    const r = await result('describe_site_area')
    expect(r.osm).toBeUndefined()
    expect(r.parcels).toHaveLength(2)
    expect(r.shoreline).toBeDefined()
    expect(r.notes.join(' ')).toMatch(/osm_unavailable/)
  })

  it('an Overpass answer that is only a timeout remark is unavailable, not "nothing mapped"', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ remark: 'runtime error: Query timed out', elements: [] }) })
    const r = await result('describe_site_area')
    expect(r.osm).toBeUndefined()
    expect(r.notes.join(' ')).toMatch(/osm_unavailable/)
  })

  it('a failed coastline lookup is a note, not a failed tool', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(shoreAround).mockRejectedValue(new Error('no COASTLINE_POSTGRES_URL'))
    const r = await result('describe_site_area')
    expect(r.shoreline).toBeUndefined()
    expect(r.notes.join(' ')).toMatch(/shoreline_unavailable/)
    expect(r.osm.features.length).toBeGreaterThan(0)
  })

  it('OSM answers are cached per site: a second call (even a failing network) is served from memory', async () => {
    await result('describe_site_area')
    const calls = fetchMock.mock.calls.length // one request per Overpass mirror, raced
    expect(calls).toBeGreaterThan(0)
    fetchMock.mockRejectedValue(new Error('down'))
    const r = await result('describe_site_area')
    expect(fetchMock).toHaveBeenCalledTimes(calls)
    expect(r.osm.features.length).toBeGreaterThan(0)
  })

  it('a failed fetch is remembered briefly so one turn does not wait on a dead service repeatedly', async () => {
    fetchMock.mockRejectedValue(new Error('down'))
    await result('describe_site_area')
    const calls = fetchMock.mock.calls.length
    await result('describe_site_area')
    expect(fetchMock.mock.calls.length).toBe(calls)
  })

  it('include narrows the scene: parcels only reads no shoreline and does no network', async () => {
    const r = await result('describe_site_area', { include: ['parcels'] })
    expect(r.parcels).toHaveLength(2)
    expect(r.shoreline).toBeUndefined()
    expect(r.osm).toBeUndefined()
    expect(shoreAround).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('radius_m filters OSM: at 25 m the road (20 m) and toilets (15 m) stay, the promenade (30 m) goes', async () => {
    const r = await result('describe_site_area', { radius_m: 25 })
    const ids = (r.osm?.features ?? []).map((f: any) => f.id)
    expect(ids).toContain('n7') // 15 m
    expect(ids).toContain('w1') // 20 m
    expect(ids).not.toContain('w3') // 30 m
  })

  it('rejects an out-of-range radius and unknown fields before running', async () => {
    expect((await call('describe_site_area', { radius_m: 99999 })).accepted).toBe(false)
    expect((await call('describe_site_area', { include: ['everything'] })).accepted).toBe(false)
    expect((await call('describe_site_area', { site_id: 'other' })).accepted).toBe(false)
  })

  it('is scoped to the route-bound site and refuses a non-owner', async () => {
    await result('describe_site_area')
    expect(getParcelSummaries).toHaveBeenCalledWith(SITE)
    for (const c of [...vi.mocked(prisma.inventoryItem.count).mock.calls, ...vi.mocked(prisma.inventoryItem.findMany).mock.calls]) {
      expect((c[0] as any).where.siteId).toBe(SITE)
    }
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: 'someone-else' } as never)
    expect(await result('describe_site_area')).toEqual({ ok: false, error: 'forbidden' })
  })

  it('aggregates many ungrouped seats instead of listing them', async () => {
    const seat = (i: number) => ({ number: i, seatLabel: null, locationLat: String(at(i, 5).lat), locationLng: String(at(i, 5).lng), schematicX: null, schematicY: null })
    vi.mocked(prisma.inventoryItem.count).mockResolvedValue(40 as never)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue(Array.from({ length: 40 }, (_, i) => seat(i + 1)) as never)
    const r = await result('describe_site_area', { include: ['seats'] })
    expect(r.ungrouped_seats).toMatchObject({ count: 40, aggregated: true })
    expect(r.ungrouped_seats.nearest_to_origin[0].seat).toBe('#1')
    expect(r.ungrouped_seats.bbox[0]).toBeCloseTo(1, 0)
  })
})

describe('describe_site_area (schematic site)', () => {
  beforeEach(() => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER, layoutMode: 'schematic' } as never)
    vi.mocked(getParcelSummaries).mockResolvedValue({ parcels: [schParcel(1, 10, 10), schParcel(2, 30, 10)], ungroupedCount: 0 })
    vi.mocked(prisma.layoutElement.findMany).mockResolvedValue([
      { id: 'cl000000bar001', type: 'bar', shape: 'rect', label: 'Beach bar', x: 40, y: 20, width: 6, height: 4, rotation: 0, z: 1 },
      { id: 'cl000000wat001', type: 'water', shape: 'rect', label: null, x: 0, y: 60, width: 80, height: 20, rotation: 0, z: 0 },
    ] as never)
  })

  it('lists parcels and elements in the y-up frame (canvas y negated) and does no OSM / shoreline IO', async () => {
    const r = await result('describe_site_area')
    expect(r.frame.mode).toBe('schematic')
    expect(r.parcels[0].centre).toEqual([10, -10])
    const bar = r.elements.find((e: any) => e.type === 'bar')
    expect(bar).toMatchObject({ element: 'bar001', label: 'Beach bar', centre: [43, -22], size_m: [6, 4] })
    expect(bar.corners).toHaveLength(4)
    expect(r.osm).toBeUndefined()
    expect(r.notes.join(' ')).toMatch(/schematic/)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(shoreAround).not.toHaveBeenCalled()
    expect((vi.mocked(prisma.layoutElement.findMany).mock.calls[0]![0] as any).where).toEqual({ siteId: SITE })
  })
})

describe('measure', () => {
  it('parcel to parcel agrees with measure_parcels (same pair, same target)', async () => {
    const a = await result('measure', { a: { parcel: 5 }, b: { parcel: 4 }, target_gap_m: 2 })
    const b = await result('measure_parcels', { from: 5, to: 4, target_gap_m: 2 })
    expect(a).toMatchObject({ ok: true, a: 'parcel 5', b: 'parcel 4', edgeGapM: b.edgeGapM, overlapping: false, centreBearingDegrees: 270 })
    expect(a.edgeGapM).toBeCloseTo(27.9, 1)
    expect(a.by_m.dx).toBeCloseTo(b.by_m.dx, 1)
    expect(a.by_m.dy).toBeCloseTo(b.by_m.dy, 1)
    expect(a.resultingGapM).toBe(2)
  })

  it('without target_gap_m it only measures (no by_m)', async () => {
    const a = await result('measure', { a: { parcel: 5 }, b: { parcel: 4 } })
    expect(a.by_m).toBeUndefined()
    expect(a.targetGapM).toBeUndefined()
  })

  it('a parcel to the shoreline agrees with measure_to_sea, and the direction points at the sea', async () => {
    const m = await result('measure', { a: { parcel: 4 }, b: { shoreline: true }, target_gap_m: 5 })
    const s = await result('measure_to_sea', { parcels: [4], target_distance_m: 5 })
    expect(m.edgeGapM).toBeCloseTo(s.parcels[0].distanceToWaterM, 1)
    expect(m.by_m.dx).toBeCloseTo(s.parcels[0].by_m.dx, 1)
    expect(m.centreBearingDegrees).toBe(90)
    expect(m.resultingGapM).toBeCloseTo(5, 1)
    expect(m.meaning).toMatch(/waterline/)
  })

  it('a parcel to an OSM road from describe_site_area: gap, perpendicular direction, and the move lands at the target', async () => {
    await result('describe_site_area')
    const m = await result('measure', { a: { parcel: 4 }, b: { osm: 'w1' }, target_gap_m: 3 })
    // road is 20 m north of the origin; parcel 4's top edge is 1.05 m north of it -> 18.95, shown to 0.1 m
    expect(m.edgeGapM).toBe(19)
    expect(m.direction).toEqual({ dx: 0, dy: 1 })
    expect(m.by_m.dy).toBeCloseTo(15.95, 1)
    expect(m.by_m.dx).toBeCloseTo(0, 1)
    expect(m.resultingGapM).toBeCloseTo(3, 1)
  })

  it('an OSM ref works even if describe_site_area was not called (fetched on demand), and says unavailable when it cannot', async () => {
    expect((await result('measure', { a: { parcel: 4 }, b: { osm: 'n7' } })).edgeGapM).toBeCloseTo(13.95, 1)
    resetOsmCache()
    fetchMock.mockRejectedValue(new Error('down'))
    expect(await result('measure', { a: { parcel: 4 }, b: { osm: 'n7' } })).toEqual({ ok: false, error: 'b: osm_unavailable' })
  })

  it('a point is { lat, lng } or local { x, y }; align facts come with a parcel b', async () => {
    const byXY = await result('measure', { a: { point: { x: 10, y: 0 } }, b: { parcel: 4 } })
    expect(byXY.edgeGapM).toBe(9) // 8.95
    const ll = at(10, 0)
    const byLL = await result('measure', { a: { point: { lat: ll.lat, lng: ll.lng } }, b: { parcel: 4 } })
    expect(byLL.edgeGapM).toBe(9)
    // parcel 5 is 30 m east of 4 on the same row line: rows are level, columns are 30 m apart
    const al = (await result('measure', { a: { parcel: 5 }, b: { parcel: 4 } })).alignment
    expect(al.offsetAlongRowsM).toBeCloseTo(30, 0)
    expect(al.by_m_to_share_rows.dy).toBeCloseTo(0, 1)
    expect(al.by_m_to_share_columns.dx).toBeCloseTo(-30, 0)
  })

  it('rejects bad refs with a reason the model can act on', async () => {
    expect(await result('measure', { a: { parcel: 4, seat: '1-1-1-1' }, b: { parcel: 5 } })).toMatchObject({ ok: false, error: expect.stringMatching(/^a: give exactly one/) })
    expect(await result('measure', { a: { parcel: 4 }, b: {} })).toMatchObject({ ok: false, error: expect.stringMatching(/^b: give exactly one/) })
    expect(await result('measure', { a: { parcel: 99 }, b: { parcel: 4 } })).toEqual({ ok: false, error: 'a: parcel_not_found' })
    expect(await result('measure', { a: { shoreline: true }, b: { parcel: 4 } })).toMatchObject({ ok: false, error: expect.stringMatching(/shoreline cannot move/) })
    expect(await result('measure', { a: { point: { x: 1 } }, b: { parcel: 4 } })).toMatchObject({ ok: false, error: expect.stringMatching(/needs both x and y/) })
    expect(await result('measure', { a: { element: 'Bar' }, b: { parcel: 4 } })).toMatchObject({ ok: false, error: expect.stringMatching(/schematic sites only/) })
    expect((await call('measure', { a: { parcel: 4 } })).accepted).toBe(false)
    expect((await call('measure', { a: { parcel: 4, foo: 1 }, b: { parcel: 5 } })).accepted).toBe(false)
    expect(await result('measure', { a: { parcel: 4 }, b: { parcel: 4 } })).toMatchObject({ ok: false })
  })

  it('shoreline problems come back as a reason, not a crash', async () => {
    vi.mocked(shoreAround).mockResolvedValue({ ways: [], water: [] } as never)
    expect(await result('measure', { a: { parcel: 4 }, b: { shoreline: true } })).toEqual({ ok: false, error: 'b: no_shore_within_1500m' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(shoreAround).mockRejectedValue(new Error('x'))
    expect(await result('measure', { a: { parcel: 4 }, b: { shoreline: true } })).toEqual({ ok: false, error: 'b: coastline_unavailable' })
  })
})

describe('measure: site scoping', () => {
  it('a seat id resolves through a query scoped to THIS site (label 1-2-3-1 is stored as 1-203-1)', async () => {
    vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue({ number: 10203, seatLabel: '1-203-1', locationLat: String(at(5, 5).lat), locationLng: String(at(5, 5).lng), schematicX: null, schematicY: null } as never)
    const m = await result('measure', { a: { seat: '1-2-3-1' }, b: { parcel: 4 } })
    expect(m.ok).toBe(true)
    expect(m.a).toBe('seat 1-2-3-1')
    expect(prisma.inventoryItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ siteId: SITE, seatLabel: '1-203-1' }) }))
    vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue(null as never)
    expect(await result('measure', { a: { seat: '9-9-9-9' }, b: { parcel: 4 } })).toEqual({ ok: false, error: 'a: seat_not_found' })
    expect(await result('measure', { a: { seat: 'banana' }, b: { parcel: 4 } })).toMatchObject({ ok: false })
    expect(await result('measure', { a: { seat: '1-2-3' }, b: { parcel: 4 } })).toMatchObject({ ok: false, error: expect.stringMatching(/member number/) })
  })

  it('an OSM id listed for site A does not resolve for site B (the cache is per site)', async () => {
    await result('describe_site_area') // fills SITE's cache with w1
    fetchMock.mockRejectedValue(new Error('down'))
    const other = { ...ctx, siteId: OTHER }
    expect(await result('measure', { a: { parcel: 4 }, b: { osm: 'w1' } }, other)).toEqual({ ok: false, error: 'b: osm_unavailable' })
    expect(getParcelSummaries).toHaveBeenLastCalledWith(OTHER)
  })

  it('parcel numbers resolve only among THIS site\'s parcels', async () => {
    vi.mocked(getParcelSummaries).mockImplementation(async (id: string) => ({ parcels: id === SITE ? [geoParcel(4, 0, 0)] : [geoParcel(7, 0, 0)], ungroupedCount: 0 }))
    expect(await result('measure', { a: { parcel: 7 }, b: { parcel: 4 } })).toEqual({ ok: false, error: 'a: parcel_not_found' })
  })
})

describe('measure (schematic site)', () => {
  beforeEach(() => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER, layoutMode: 'schematic' } as never)
    vi.mocked(getParcelSummaries).mockResolvedValue({ parcels: [schParcel(1, 10, 10), schParcel(2, 30, 10)], ungroupedCount: 0 })
    const rows = [
      { id: 'cl000000bar001', type: 'bar', shape: 'rect', label: 'Beach bar', x: 40, y: 8, width: 6, height: 4, rotation: 0, z: 1 },
      { id: 'cl000000bar002', type: 'bar', shape: 'rect', label: 'Pool bar', x: 60, y: 8, width: 6, height: 4, rotation: 0, z: 1 },
      { id: 'cl000000wat001', type: 'water', shape: 'rect', label: null, x: 0, y: 60, width: 80, height: 20, rotation: 0, z: 0 },
    ]
    // honour the `type` filter the water lookup passes
    vi.mocked(prisma.layoutElement.findMany).mockImplementation((async (args: any) => rows.filter((r) => !args?.where?.type || r.type === args.where.type)) as never)
  })

  it('parcel to a labelled element: gap along the row, move east for a 1 m gap; resolved within the site', async () => {
    const m = await result('measure', { a: { parcel: 2 }, b: { element: 'beach bar' }, target_gap_m: 1 })
    // parcel 2 spans x 28.95..31.05; the bar starts at x = 40
    expect(m.edgeGapM).toBe(9) // 8.95
    expect(m.direction.dx).toBeGreaterThan(0.99)
    expect(m.by_m.dx).toBeCloseTo(7.95, 1)
    expect(m.b).toMatch(/Beach bar/)
    expect((vi.mocked(prisma.layoutElement.findMany).mock.calls[0]![0] as any).where.siteId).toBe(SITE)
  })

  it('an element can be named by handle or type; an ambiguous name lists the handles', async () => {
    expect((await result('measure', { a: { parcel: 2 }, b: { element: 'bar002' } })).b).toMatch(/Pool bar/)
    const amb = await result('measure', { a: { parcel: 2 }, b: { element: 'bar' } })
    expect(amb.ok).toBe(false)
    expect(amb.error).toMatch(/bar001/)
    expect(amb.error).toMatch(/bar002/)
    expect(await result('measure', { a: { parcel: 2 }, b: { element: 'nope' } })).toEqual({ ok: false, error: 'b: element_not_found' })
  })

  it('the shoreline of a schematic is its water elements; y is up (the sea is SOUTH of parcels drawn above it)', async () => {
    const m = await result('measure', { a: { parcel: 1 }, b: { shoreline: true }, target_gap_m: 5 })
    expect(m.centreBearingDegrees).toBe(180)
    expect(m.edgeGapM).toBeCloseTo(60 - 11.05, 1)
    expect(m.by_m.dy).toBeLessThan(0)
    expect(m.resultingGapM).toBeCloseTo(5, 1)
    expect(shoreAround).not.toHaveBeenCalled()
  })

  it('overlap and containment are reported: a point inside a parcel', async () => {
    const m = await result('measure', { a: { point: { x: 10.5, y: -10 } }, b: { parcel: 1 } })
    expect(m).toMatchObject({ overlapping: true, containment: 'the point is inside parcel 1' })
    expect(m.edgeGapM).toBeCloseTo(-0.6, 1) // 0.55 m from the east edge
    // exactly at the centre there is still an answer; only a MOVE has no direction
    const c = await result('measure', { a: { point: { x: 10, y: -10 } }, b: { parcel: 1 } })
    expect(c).toMatchObject({ ok: true, overlapping: true, direction: { dx: 0, dy: 0 } })
    expect(await result('measure', { a: { point: { x: 10, y: -10 } }, b: { parcel: 1 }, target_gap_m: 1 })).toMatchObject({ ok: false })
  })
})
