/**
 * The assistant's shared spatial maths (track 030 G2). Expected numbers are worked out by hand from the
 * geometry, not read back from the code: a 2x2 square at the origin, a diamond with half-diagonal 1.5 whose
 * nearest vertex is 3.5 m away, a road 10 m north, and so on.
 */
import { describe, it, expect } from 'vitest'
import { geoFrame, M_PER_DEG, schematicFrame, toLocal, toSite, bearingOf, unitOf } from './frame'
import { centroid, capPoints, containsShape, shapeGap, simplifyLine, type Pt, type Shape } from './shapes'
import { alignmentFacts, elementPolygon, lineFeature, moveToGap, pointFeature, polygonFeature, relate } from './features'
import { buildOverpassQuery, osmToFeature, parseOsmAnswer, trimOsmScene, type OsmFeature } from './osm'
import { formatScene, MAX_LISTED_SEATS, SHORE_POINT_BUDGET } from './describe'

const sq = (x: number, y: number, s = 2): Pt[] => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }]
const poly = (pts: Pt[]): Shape => ({ kind: 'polygon', pts })
const line = (...p: Array<[number, number]>): Shape => ({ kind: 'line', pts: p.map(([x, y]) => ({ x, y })) })
const point = (x: number, y: number): Shape => ({ kind: 'point', pts: [{ x, y }] })
const diamond = (cx: number, cy: number, h: number): Pt[] => [{ x: cx - h, y: cy }, { x: cx, y: cy - h }, { x: cx + h, y: cy }, { x: cx, y: cy + h }]

describe('frames', () => {
  it('schematic: local y is the canvas y negated, and the round trip is exact', () => {
    const f = schematicFrame()
    expect(toLocal(f, { x: 12, y: 30 })).toEqual({ x: 12, y: -30 })
    expect(toSite(f, { x: 12, y: -30 })).toEqual({ x: 12, y: 30 })
    expect(toLocal(f, { lat: 1, lng: 2 })).toBeNull() // lat/lng on a schematic is a mode mismatch, never silently zero
  })

  it('geo: 10 m north is 10/111320 deg of latitude, 10 m east at 60N is 10/(111320*cos60) deg of longitude', () => {
    const f = geoFrame({ lat: 60, lng: 10 })
    const n = toSite(f, { x: 0, y: 10 }) as { lat: number; lng: number }
    const e = toSite(f, { x: 10, y: 0 }) as { lat: number; lng: number }
    expect(n.lat).toBeCloseTo(60 + 10 / M_PER_DEG, 9)
    expect(e.lng).toBeCloseTo(10 + 10 / (M_PER_DEG * 0.5), 7)
    const back = toLocal(f, e)!
    expect(back.x).toBeCloseTo(10, 6)
    expect(back.y).toBeCloseTo(0, 6)
    expect(toLocal(f, { x: 1, y: 1 })).toBeNull()
  })

  it('bearings are compass bearings (clockwise from north) and invert with unitOf', () => {
    expect(bearingOf({ x: 0, y: 1 })).toBe(0)
    expect(bearingOf({ x: 1, y: 0 })).toBe(90)
    expect(bearingOf({ x: 0, y: -1 })).toBe(180)
    expect(bearingOf({ x: -1, y: 0 })).toBe(270)
    expect(unitOf(90).x).toBeCloseTo(1, 9)
  })

  it('a schematic element polygon is north-up: a 4x2 box at canvas (10,6) sits at y -8..-6; rotation turns it clockwise on screen', () => {
    const p = elementPolygon({ x: 10, y: 6, width: 4, height: 2, rotation: 0 })
    expect(Math.min(...p.map((c) => c.y))).toBeCloseTo(-8, 9)
    expect(Math.max(...p.map((c) => c.y))).toBeCloseTo(-6, 9)
    const turned = elementPolygon({ x: 10, y: 6, width: 4, height: 2, rotation: 90 }) // about the centre (12,-7)
    expect(Math.max(...turned.map((c) => c.y)) - Math.min(...turned.map((c) => c.y))).toBeCloseTo(4, 9)
    expect(centroid(turned).x).toBeCloseTo(12, 9)
    expect(centroid(turned).y).toBeCloseTo(-7, 9)
  })
})

describe('shapeGap', () => {
  it('polygon-polygon: apart, touching, overlapping', () => {
    expect(shapeGap(poly(sq(0, 0)), poly(sq(5, 0))).gap).toBe(3)
    expect(shapeGap(poly(sq(0, 0)), poly(sq(2, 0)))).toMatchObject({ gap: 0, overlap: false })
    expect(shapeGap(poly(sq(0, 0)), poly(sq(1, 0)))).toMatchObject({ gap: -1, overlap: true })
  })

  it('a ROTATED polygon: a diamond whose nearest vertex is 3.5 m east is 1.5 m from the square, vertex to edge', () => {
    const g = shapeGap(poly(sq(0, 0)), poly(diamond(5, 1, 1.5)))
    expect(g.gap).toBeCloseTo(1.5, 9)
    expect(g.nearest!.a.x).toBeCloseTo(2, 9) // the square's east edge
    expect(g.nearest!.b).toEqual({ x: 3.5, y: 1 }) // the diamond's west vertex
  })

  it('rotated against rotated: two 45 degree diamonds corner to corner', () => {
    expect(shapeGap(poly(diamond(0, 0, 1)), poly(diamond(5, 0, 1))).gap).toBeCloseTo(3, 9)
    // offset diagonally: nearest are the edges facing each other
    const g = shapeGap(poly(diamond(0, 0, 1)), poly(diamond(4, 4, 1))).gap
    expect(g).toBeCloseTo(Math.hypot(4, 4) - 2 * Math.SQRT1_2, 9)
  })

  it('polyline-polygon: a road 3 m away, a road crossing the polygon, a road ending inside it', () => {
    expect(shapeGap(poly(sq(0, 0)), line([-5, 5], [10, 5])).gap).toBe(3)
    const crossing = shapeGap(poly(sq(0, 0)), line([1, -5], [1, 5]))
    expect(crossing.overlap).toBe(true)
    expect(crossing.gap).toBe(0) // crosses with no vertex inside: depth unknown, never apart
    const inside = shapeGap(poly(sq(0, 0, 4)), line([2, 2], [2, 9]))
    expect(inside.overlap).toBe(true)
    expect(inside.gap).toBeCloseTo(-2, 9) // the end vertex is 2 m from every edge
  })

  it('polyline-polyline: distance between non-crossing segments, and a proper crossing', () => {
    expect(shapeGap(line([0, 0], [10, 0]), line([0, 3], [10, 8])).gap).toBe(3)
    expect(shapeGap(line([0, 0], [10, 10]), line([0, 10], [10, 0]))).toMatchObject({ gap: 0, overlap: true })
  })

  it('point-polygon: outside is the distance, inside is the NEGATIVE depth and the point is contained', () => {
    expect(shapeGap(point(5, 1), poly(sq(0, 0))).gap).toBe(3)
    const inside = shapeGap(point(2, 2), poly(sq(0, 0, 4)))
    expect(inside).toMatchObject({ gap: -2, overlap: true, containment: 'a_in_b' })
    expect(shapeGap(point(0, 0), point(3, 4)).gap).toBe(5)
  })

  it('a NON-convex polygon (L shape): a point in the notch is outside, not inside the bounding box', () => {
    const L: Pt[] = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 6 }, { x: 0, y: 6 }]
    expect(shapeGap(point(4, 4), poly(L))).toMatchObject({ overlap: false })
    expect(shapeGap(point(4, 4), poly(L)).gap).toBeCloseTo(2, 9)
    expect(shapeGap(point(1, 1), poly(L)).overlap).toBe(true)
  })

  it('containment: a small polygon in a big one both ways, and containsShape', () => {
    const big = poly(sq(0, 0, 10))
    const small = poly(sq(4, 4, 2))
    expect(shapeGap(small, big).containment).toBe('a_in_b')
    expect(shapeGap(big, small).containment).toBe('b_in_a')
    expect(containsShape(big, small)).toBe(true)
    expect(containsShape(small, big)).toBe(false)
    expect(containsShape(big, poly(sq(8, 8, 4)))).toBe(false) // pokes out
    expect(shapeGap(poly(sq(0, 0, 10)), poly(sq(8, 8, 4))).containment).toBeNull()
  })
})

describe('relate / moveToGap', () => {
  it('square vs a road 8 m north: gap 8, direction due north, moving to a 3 m gap is 5 m north', () => {
    const a = polygonFeature(sq(0, 0))
    const road = lineFeature([{ x: -20, y: 10 }, { x: 20, y: 10 }])
    const r = relate(a, road)
    if (!r.ok) throw new Error(r.error)
    expect(r.relation.edgeGapM).toBe(8)
    expect(r.relation.direction.x).toBeCloseTo(0, 9)
    expect(r.relation.direction.y).toBeCloseTo(1, 9)
    expect(r.relation.centreBearingDegrees).toBeCloseTo(0, 9)
    const m = moveToGap(a, road, r.relation.direction, 3)!
    expect(m.by.y).toBeCloseTo(5, 6)
    expect(m.resultingGapM).toBeCloseTo(3, 2)
  })

  it('a slanted road is approached along the PERPENDICULAR, not along the line between centres', () => {
    // road y = x + 10; square at the origin: nearest point is on the perpendicular, direction (-1,1)/sqrt2
    const a = polygonFeature(sq(0, 0))
    const road = lineFeature([{ x: -30, y: -20 }, { x: 30, y: 40 }])
    const r = relate(a, road)
    if (!r.ok) throw new Error(r.error)
    expect(r.relation.direction.x).toBeCloseTo(-Math.SQRT1_2, 3)
    expect(r.relation.direction.y).toBeCloseTo(Math.SQRT1_2, 3)
    const m = moveToGap(a, road, r.relation.direction, 0)!
    const moved = polygonFeature(a.pts.map((p) => ({ x: p.x + m.by.x, y: p.y + m.by.y })))
    expect(Math.abs(shapeGap(moved, road).gap)).toBeLessThan(0.01)
  })

  it('moving AWAY works too: an overlapping pair needs a negative-direction shift to reach a positive gap', () => {
    const a = polygonFeature(sq(0, 0))
    const b = polygonFeature(sq(1, 0))
    const r = relate(a, b)
    if (!r.ok) throw new Error(r.error)
    expect(r.relation.overlapping).toBe(true)
    const m = moveToGap(a, b, r.relation.direction, 2)!
    expect(m.by.x).toBeCloseTo(-3, 6) // overlap 1 -> gap 2 = 3 m west
    expect(m.resultingGapM).toBeCloseTo(2, 2)
  })

  it('rotated polygons: applying by_m really lands the outlines at the target gap', () => {
    const a = polygonFeature(diamond(0, 0, 1.2))
    const b = polygonFeature(sq(7, 3, 3))
    const r = relate(a, b)
    if (!r.ok) throw new Error(r.error)
    const m = moveToGap(a, b, r.relation.direction, 2.5)!
    const moved = diamond(0, 0, 1.2).map((p) => ({ x: p.x + m.by.x, y: p.y + m.by.y }))
    expect(shapeGap(poly(moved), poly(sq(7, 3, 3))).gap).toBeCloseTo(2.5, 1)
  })

  it('a point to a polygon and identical reference points', () => {
    const r = relate(pointFeature({ x: 10, y: 0 }), polygonFeature(sq(0, -1)))
    if (!r.ok) throw new Error(r.error)
    expect(r.relation.edgeGapM).toBe(8)
    expect(r.relation.centreBearingDegrees).toBe(270)
    // identical centres: still reports overlap/containment, just no direction
    const same = relate(pointFeature({ x: 1, y: 1 }), polygonFeature(sq(0, 0)))
    if (!same.ok) throw new Error(same.error)
    expect(same.relation).toMatchObject({ degenerate: true, overlapping: true, containment: 'a_in_b', direction: { x: 0, y: 0 } })
  })

  it('the shoreline as b: signed distance, direction toward the sea, and a move toward it', () => {
    // sea to the south of y = -20 (water elements model equivalent): distance = y_min - (-20)
    const model = {
      distance: (p: Pt[]) => Math.min(...p.map((q) => q.y)) + 20,
      bearing: () => 180,
    }
    const a = polygonFeature(sq(0, 0))
    const r = relate(a, { kind: 'shore', model })
    if (!r.ok) throw new Error(r.error)
    expect(r.relation.edgeGapM).toBe(20)
    expect(r.relation.direction.y).toBeCloseTo(-1, 9)
    const m = moveToGap(a, { kind: 'shore', model }, r.relation.direction, 5)!
    expect(m.by.y).toBeCloseTo(-15, 6)
    expect(relate(a, { kind: 'shore', model: { distance: () => null, bearing: () => null } })).toEqual({ ok: false, error: 'no_shore_found' })
  })
})

describe('alignmentFacts', () => {
  it('rows run east: A is 3 east / 5 north of B -> level the rows by moving 5 south, level the columns by moving 3 west', () => {
    const a = polygonFeature(sq(3, 5, 0.0001))
    const b = polygonFeature(sq(0, 0, 0.0001), { rowBearingDegrees: 90 })
    const al = alignmentFacts(a, b)!
    expect(al.offsetAlongRowsM).toBeCloseTo(3, 3)
    expect(al.offsetAcrossRowsM).toBeCloseTo(-5, 3) // "across" points south (the way rows stack)
    expect(al.by_m_to_share_rows.dx).toBeCloseTo(0, 2)
    expect(al.by_m_to_share_rows.dy).toBeCloseTo(-5, 2)
    expect(al.by_m_to_share_columns.dx).toBeCloseTo(-3, 2)
  })

  it('rotated rows (bearing 45): offsets are measured in B\'s own axes', () => {
    const a = polygonFeature(sq(10, 10, 0.0001))
    const b = polygonFeature(sq(0, 0, 0.0001), { rowBearingDegrees: 45 })
    const al = alignmentFacts(a, b)!
    expect(al.offsetAlongRowsM).toBeCloseTo(Math.hypot(10, 10), 2) // A lies exactly along B's row direction
    expect(al.offsetAcrossRowsM).toBeCloseTo(0, 2)
  })

  it('no row bearing (B is not a parcel) -> no alignment facts', () => {
    expect(alignmentFacts(polygonFeature(sq(0, 0)), polygonFeature(sq(5, 5)))).toBeNull()
  })
})

describe('simplification', () => {
  it('Douglas-Peucker drops collinear points and keeps a corner', () => {
    const l: Pt[] = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]
    expect(simplifyLine(l, 0.1)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
  })
  it('capPoints reaches the cap on a noisy 2000 point curve and keeps the endpoints', () => {
    const l = Array.from({ length: 2000 }, (_, i) => ({ x: i, y: Math.sin(i / 50) * 20 + (i % 2) * 0.1 }))
    const c = capPoints(l, 40)
    expect(c.length).toBeLessThanOrEqual(40)
    expect(c[0]).toEqual(l[0])
    expect(c[c.length - 1]).toEqual(l[l.length - 1])
  })
})

describe('OpenStreetMap parsing', () => {
  const g = (...c: Array<[number, number]>) => c.map(([lat, lon]) => ({ lat, lon }))
  const answer = {
    elements: [
      { type: 'way', id: 1, tags: { highway: 'residential', name: 'Calle Mar' }, geometry: g([39.8, 3.1], [39.8, 3.11]) },
      { type: 'way', id: 2, tags: { highway: 'footway' }, geometry: g([39.8, 3.1], [39.801, 3.1]) },
      { type: 'way', id: 3, tags: { highway: 'pedestrian', name: 'Paseo Marítimo' }, geometry: g([39.8, 3.1], [39.8, 3.2]) },
      { type: 'way', id: 4, tags: { highway: 'footway', name: 'Passeig de la Platja' }, geometry: g([39.8, 3.1], [39.8, 3.2]) },
      { type: 'way', id: 5, tags: { building: 'yes' }, geometry: g([39.8, 3.1], [39.8, 3.101], [39.801, 3.101], [39.8, 3.1]) },
      { type: 'way', id: 6, tags: { building: 'yes' }, geometry: g([39.8, 3.1], [39.8, 3.101], [39.801, 3.101]) }, // not closed: dropped
      { type: 'node', id: 7, lat: 39.8, lon: 3.1, tags: { amenity: 'toilets' } },
      { type: 'node', id: 8, lat: 39.8, lon: 3.1, tags: { emergency: 'lifeguard' } },
      { type: 'way', id: 9, tags: { amenity: 'bar' }, geometry: g([39.8, 3.1], [39.8, 3.101], [39.801, 3.101], [39.8, 3.1]) },
      { type: 'node', id: 10, lat: 39.8, lon: 3.1, tags: { shop: 'kiosk' } }, // not a kind we model
    ],
  }
  const parsed = parseOsmAnswer(answer)!
  const by = (id: string) => parsed.find((f) => f.id === id)!

  it('classifies roads, paths, promenades (pedestrian or by name), buildings and amenities', () => {
    expect(by('w1')).toMatchObject({ kind: 'road', subtype: 'residential', name: 'Calle Mar', shape: 'line' })
    expect(by('w2')).toMatchObject({ kind: 'path', subtype: 'footway' })
    expect(by('w3').kind).toBe('promenade')
    expect(by('w4').kind).toBe('promenade') // a footway NAMED passeig is the promenade
    expect(by('w5')).toMatchObject({ kind: 'building', shape: 'polygon' })
    expect(by('w5').pts).toHaveLength(3) // closing vertex dropped
    expect(by('n7')).toMatchObject({ kind: 'poi', subtype: 'toilets', shape: 'point' })
    expect(by('n8')).toMatchObject({ kind: 'poi', subtype: 'lifeguard' })
    expect(by('w9')).toMatchObject({ kind: 'poi', subtype: 'bar', shape: 'polygon' })
    expect(parsed.find((f) => f.id === 'w6')).toBeUndefined()
    expect(parsed.find((f) => f.id === 'n10')).toBeUndefined()
  })

  it('an Overpass remark about a timeout is an incomplete answer, never "nothing here"', () => {
    expect(parseOsmAnswer({ remark: 'runtime error: Query timed out', elements: [] })).toBeNull()
    expect(parseOsmAnswer({} as never)).toBeNull()
  })

  it('the query asks around the centre with the radius and bounded output', () => {
    const q = buildOverpassQuery({ lat: 39.8335, lng: 3.1212 }, 300)
    expect(q).toContain('around:300,39.833500,3.121200')
    expect(q).toMatch(/out geom \d+;/)
    expect(q).toContain('"emergency"="lifeguard"')
  })

  it('placed in the local frame: 0.001 deg north of the origin is 111.32 m north; schematic frames cannot place OSM', () => {
    const f = osmToFeature({ id: 'n1', kind: 'poi', subtype: 'bar', shape: 'point', pts: [{ lat: 40.001, lng: 3 }] }, geoFrame({ lat: 40, lng: 3 }))!
    expect(f.pts[0]!.y).toBeCloseTo(111.32, 2)
    expect(f.pts[0]!.x).toBeCloseTo(0, 6)
    expect(osmToFeature({ id: 'n1', kind: 'poi', subtype: 'bar', shape: 'point', pts: [{ lat: 40.001, lng: 3 }] }, schematicFrame())).toBeNull()
  })

  it('trimOsmScene: radius filter, nearest-first caps with a dropped count, long lines clipped and simplified', () => {
    const frame = geoFrame({ lat: 40, lng: 3 })
    const at = (north: number, east = 0) => ({ lat: 40 + north / M_PER_DEG, lng: 3 + east / (M_PER_DEG * Math.cos((40 * Math.PI) / 180)) })
    const poi = (n: number, north: number): OsmFeature => ({ id: `n${n}`, kind: 'poi', subtype: 'bar', shape: 'point', pts: [at(north)] })
    const longRoad: OsmFeature = {
      id: 'w1', kind: 'road', subtype: 'residential', shape: 'line',
      pts: Array.from({ length: 400 }, (_, i) => at(10, -1000 + i * 5)), // east-west road 10 m north, 2 km long
    }
    const scene = trimOsmScene([poi(1, 50), poi(2, 20), poi(3, 900), poi(4, 30), longRoad], frame, 100, { promenade: 5, poi: 2, path: 5, road: 5, building: 5 })
    expect(scene.items.filter((i) => i.kind === 'poi').map((i) => i.id)).toEqual(['n2', 'n4']) // nearest first; n3 is outside 100 m, n1 is capped
    expect(scene.dropped).toEqual({ poi: 1 })
    const road = scene.items.find((i) => i.id === 'w1')!
    expect(road.pts.length).toBeLessThanOrEqual(14)
    expect(Math.max(...road.pts.map((p) => Math.abs(p.x)))).toBeLessThan(200) // clipped to the window, not 1 km each way
    expect(road.distanceM).toBeCloseTo(10, 0)
  })
})

describe('formatScene', () => {
  const frame = schematicFrame()
  const parcel = (n: number) => ({ parcel: n, corners: sq(n * 10, -5, 2.04), centre: { x: n * 10 + 1.02, y: -3.98 }, rowBearingDegrees: 90.2, seats: 4, rows: 1, seatsPerRow: 4 })

  it('rounds to 0.1 m, labels the frame, and orders parcels by number', () => {
    const s = formatScene({ frame, radiusM: 300, parcels: [parcel(2), parcel(1)] }) as any
    expect(s.frame.mode).toBe('schematic')
    expect(s.frame.axes).toMatch(/NORTH/)
    expect(s.parcels.map((p: any) => p.parcel)).toEqual([1, 2])
    expect(s.parcels[0].centre).toEqual([11, -4])
    expect(s.parcels[0].corners[0]).toEqual([10, -5])
    expect(s.parcels[0].row_bearing_deg).toBe(90)
  })

  it('few ungrouped seats are listed; many are aggregated (count, centroid, bbox, 5 nearest)', () => {
    const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `#${i + 1}`, at: { x: i, y: -2 * i } }))
    const few = formatScene({ frame, radiusM: 1, ungroupedSeats: { total: 3, seats: seats(3) } }) as any
    expect(few.ungrouped_seats.seats).toHaveLength(3)
    const n = MAX_LISTED_SEATS + 20
    const many = formatScene({ frame, radiusM: 1, ungroupedSeats: { total: n, seats: seats(n) } }) as any
    expect(many.ungrouped_seats).toMatchObject({ count: n, aggregated: true, bbox: [0, -2 * (n - 1), n - 1, 0] })
    expect(many.ungrouped_seats.nearest_to_origin).toHaveLength(5)
    expect(many.ungrouped_seats.seats).toBeUndefined()
  })

  it('caps parcels and says so', () => {
    const s = formatScene({ frame, radiusM: 1, parcels: Array.from({ length: 70 }, (_, i) => parcel(i + 1)) }) as any
    expect(s.parcels).toHaveLength(60)
    expect(s.notes.join(' ')).toMatch(/showing 60 of 70/)
  })

  it('a 1500 point shoreline comes out within the point budget; the sea ring is clipped to the area (far corners dropped)', () => {
    const shore = Array.from({ length: 1500 }, (_, i) => ({ x: -750 + i, y: -40 + Math.sin(i / 30) * 6 }))
    const ring = [{ x: -9000, y: -9000 }, { x: 9000, y: -9000 }, { x: 9000, y: -50 }, { x: 100, y: -50 }, { x: -100, y: -50 }, { x: -9000, y: -50 }]
    const s = formatScene({ frame: geoFrame({ lat: 40, lng: 3 }), radiusM: 300, shore: { lines: [shore], water: [ring], seaBearingDegrees: 180.4, distanceFromOriginM: 40.04 } }) as any
    const total = s.shoreline.lines.flat().length + (s.shoreline.water_edge_clipped_to_area ?? []).flat().length
    expect(total).toBeLessThanOrEqual(SHORE_POINT_BUDGET)
    expect(s.shoreline.sea_bearing_from_origin_deg).toBe(180)
    expect(s.shoreline.distance_origin_to_waterline_m).toBe(40)
    expect(s.shoreline.water_edge_clipped_to_area[0].every((p: number[]) => Math.abs(p[0]!) <= 450)).toBe(true)
  })

  it('osm items carry id, kind, type, distance and the right geometry key', () => {
    const s = formatScene({
      frame: geoFrame({ lat: 40, lng: 3 }), radiusM: 100,
      osm: {
        total: 3, dropped: { building: 4 },
        items: [
          { id: 'n1', kind: 'poi', subtype: 'lifeguard', distanceM: 12.34, shape: 'point', pts: [{ x: 5.55, y: 6.66 }] },
          { id: 'w2', kind: 'road', subtype: 'service', name: 'Via', distanceM: 20, shape: 'line', pts: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
          { id: 'w3', kind: 'building', subtype: 'yes', distanceM: 30, shape: 'polygon', pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
        ],
      },
    }) as any
    expect(s.osm.features[0]).toEqual({ id: 'n1', kind: 'poi', type: 'lifeguard', dist_m: 12.3, at: [5.6, 6.7] })
    expect(s.osm.features[1].line).toHaveLength(2)
    expect(s.osm.features[2].area).toHaveLength(3)
    expect(s.osm.dropped_by_cap).toEqual({ building: 4 })
  })
})
