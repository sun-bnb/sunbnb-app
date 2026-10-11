/**
 * Inventory proposals (track 030 S4a), unit level: a fake in-memory seat table stands in for Postgres,
 * the pure geometry is REAL, the server actions are mocked so the tests assert exactly which calls
 * apply would make. End-to-end (preview == database result, undo) is
 * `inventory.integration.test.ts` -> app/assistant/inventory.integration.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@repo/data/assistant', () => ({ createProposal: vi.fn() }))
vi.mock('@/app/sites/[id]/inventory/actions', () => ({
  syncChairsWithLayout: vi.fn(), moveParcel: vi.fn(), moveItems: vi.fn(), rotateSelection: vi.fn(), adjustItemSpacing: vi.fn(),
  reverseParcelNumbering: vi.fn(), reverseParcelOrientation: vi.fn(),
}))
vi.mock('@/app/sites/[id]/inventory/parcel-ops', () => ({
  applyParcelConfig: vi.fn(), rotateParcel: vi.fn(), rotateUnit: vi.fn(), setSeatsStatus: vi.fn(),
}))
vi.mock('@/app/sites/[id]/inventory-actions', () => ({ deleteInventoryItems: vi.fn(), deleteItemsByGroup: vi.fn() }))

import { executeToolCall } from '@repo/agent/loop'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { createProposal } from '@repo/data/assistant'
import { devicesBlockingSeatRemoval } from '@repo/data/unit'
import { recomputeSeatLabels } from '@repo/data/seat-label-db'
import * as actions from '@/app/sites/[id]/inventory/actions'
import * as parcelOps from '@/app/sites/[id]/inventory/parcel-ops'
import * as inventoryActions from '@/app/sites/[id]/inventory-actions'
import { generateChairs, type ChairConfig } from '@/app/sites/[id]/inventory/chair-util'
import { metresToDelta, rotatePositions } from '@/app/sites/[id]/inventory/geometry'
import { getAssistantTools, type AssistantToolCtx } from '../tools'
import { diffBasis } from './types'
import { inventoryHandler } from './handlers/inventory'
import { simulate } from './inventory-sim'
import { CONV, OWNER, SITE } from './test-support'

const OTHER_SITE = 'site-other'
const tools = getAssistantTools()
const emit = vi.fn()
const ctx: AssistantToolCtx = { session: { user: { id: OWNER } }, accountId: OWNER, siteId: SITE, locale: 'en', conversationId: CONV, emit }
const hctx = { siteId: SITE, accountId: OWNER }

// ─── fake database ──────────────────────────────────────────────────────────

type Row = Record<string, any>
let seats: Row[] = []
let igs: Row[] = []
let units: Row[] = []
let layoutMode: 'geo' | 'schematic' = 'geo'
let booked = 0

interface ParcelOpts { rows?: number; spr?: number; lat?: number; lng?: number; rotation?: number; paired?: boolean; siteId?: string; hGap?: number; vGap?: number; status?: string }

/** Seed a parcel through the REAL generator, with units and labels like the editor produces. */
function addParcel(n: number, o: ParcelOpts = {}) {
  const { rows = 2, spr = 4, lat = 36.7213, lng = -4.4214, rotation = 0, paired = true, siteId = SITE, hGap = 1, vGap = 1.5, status = 'active' } = o
  const config: ChairConfig = { group: n, rows, seatsPerRow: spr, baseLat: lat, baseLng: lng, horizontalGap: hGap, verticalGap: vGap, intraPairGap: 0.4, rotation, pairSeats: paired }
  igs.push({
    id: `ig-${n}`, number: n, rows, seatsPerRow: spr, horizontalGap: hGap, verticalGap: vGap, pairGap: 0.4, rotation,
    category: 'PRICE1', price: 9, locationLat: String(lat), locationLng: String(lng), schematicX: null, schematicY: null,
  })
  for (const g of generateChairs(config)) {
    const row = Math.floor(g.number / 100) % 100
    const col = g.number % 100
    const unitIdx = paired ? Math.floor((col - 1) / 2) + 1 : col
    const member = paired ? ((col - 1) % 2) + 1 : 1
    const unit = `u-${n}-${row}-${unitIdx}`
    if (!units.some((u) => u.id === unit)) units.push({ id: unit, siteId, seq: unitIdx })
    seats.push({
      id: `s-${g.number}`, siteId, number: g.number, group: n, status, rotation: g.rotation,
      locationLat: g.locationLat, locationLng: g.locationLng, schematicX: null, schematicY: null,
      itemGroupId: `ig-${n}`, sunbedGroupId: unit, seatLabel: `${n}-${row}${String(unitIdx).padStart(2, '0')}-${member}`,
    })
  }
}

const cmp = (field: unknown, cond: any): boolean => {
  if (cond === undefined) return true
  if (cond !== null && typeof cond === 'object') {
    if ('in' in cond) return (cond.in as unknown[]).includes(field)
    if ('not' in cond) return field !== cond.not
    if ('startsWith' in cond) return typeof field === 'string' && field.startsWith(cond.startsWith)
    if ('gte' in cond) return (field as number) >= cond.gte
  }
  return field === cond
}
const matches = (r: Row, where: Row = {}) => Object.entries(where).every(([k, v]) => (k === 'OR' ? (v as Row[]).some((w) => matches(r, w)) : cmp(r[k], v)))

function wireDb() {
  vi.mocked(prisma.site.findUnique).mockImplementation((async () => ({ userId: OWNER, layoutMode })) as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as never)
  vi.mocked(prisma.inventoryItem.findMany).mockImplementation((async (a: any) => seats.filter((r) => matches(r, a?.where)).map((r) => ({ ...r }))) as never)
  vi.mocked(prisma.inventoryItem.count).mockImplementation((async (a: any) => seats.filter((r) => matches(r, a?.where)).length) as never)
  vi.mocked(prisma.inventoryItem.aggregate).mockImplementation((async (a: any) => ({ _max: { group: Math.max(0, ...seats.filter((r) => matches(r, a?.where)).map((r) => r.group)) } })) as never)
  vi.mocked(prisma.itemGroup.findUnique).mockImplementation((async (a: any) => igs.find((g) => g.id === a.where.id) ?? null) as never)
  vi.mocked(prisma.itemGroup.findMany).mockImplementation((async (a: any) => igs.filter((g) => matches(g, a?.where))) as never)
  vi.mocked(prisma.sunbedGroup.findMany).mockImplementation((async (a: any) => units.filter((u) => matches(u, a?.where))) as never)
  vi.mocked(prisma.reservation.count).mockImplementation((async () => booked) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  seats = []; igs = []; units = []; layoutMode = 'geo'; booked = 0
  vi.mocked(auth).mockResolvedValue({ user: { id: OWNER } } as never)
  vi.mocked(createProposal).mockResolvedValue({ id: 'act-1' } as never)
  vi.mocked(devicesBlockingSeatRemoval).mockResolvedValue([])
  wireDb()
})

type Result = Record<string, any>
async function call(name: string, input: Record<string, unknown>, c: AssistantToolCtx = ctx): Promise<Result> {
  const ex = await executeToolCall(tools, { id: 't1', name, arguments: JSON.stringify(input) }, c)
  return ex.accepted ? (ex.result as Result) : { ok: false, errors: ex.errors }
}
async function ok(name: string, input: Record<string, unknown>, c?: AssistantToolCtx): Promise<Result> {
  const res = await call(name, input, c)
  expect(res.ok, JSON.stringify(res)).toBe(true)
  return res
}
async function refused(name: string, input: Record<string, unknown>, c?: AssistantToolCtx): Promise<Result> {
  vi.mocked(createProposal).mockClear()
  const res = await call(name, input, c)
  expect(res.ok, JSON.stringify(res)).toBe(false)
  expect(createProposal).not.toHaveBeenCalled()
  return res
}
const stored = () => vi.mocked(createProposal).mock.calls.at(-1)![0] as any
const storedGeometry = () => stored().preview.geometry
const payloadOf = () => stored().payload.data
const msg = (r: Result) => String(r.error ?? r.errors?.join() ?? '')

// ─── resolution + scoping ───────────────────────────────────────────────────

describe('handles resolve inside the site only', () => {
  it('a parcel number that exists only on another site is "not found" (nothing stored)', async () => {
    addParcel(1, { siteId: OTHER_SITE })
    const res = await refused('propose_rotate', { target: { parcel: 1 }, degrees: 90 })
    expect(res.error ?? res.errors?.join()).toMatch(/Parcel 1 was not found/)
  })

  it('every seat / parcel lookup is scoped by the open site id', async () => {
    addParcel(1)
    await ok('propose_rotate', { target: { seats: ['1-1-1-1'] }, degrees: 30 })
    const calls = vi.mocked(prisma.inventoryItem.findMany).mock.calls.map((c) => (c[0] as any).where)
    expect(calls.length).toBeGreaterThan(0)
    for (const w of calls) expect(w.siteId).toBe(SITE)
  })

  it('a sunbed id of another site is not found', async () => {
    addParcel(1, { siteId: OTHER_SITE })
    const res = await refused('propose_rotate', { target: { seats: ['1-1-1-1'] }, degrees: 30 })
    expect(res.error ?? res.errors?.join()).toMatch(/not found/)
  })

  it('rejects ids that are not "parcel-row-unit-member" (a cuid cannot be smuggled in as a handle)', async () => {
    addParcel(1)
    const res = await refused('propose_rotate', { target: { seats: ['cmabc123def456ghi789jkl'] }, degrees: 30 })
    expect(res.error ?? res.errors?.join()).toMatch(/not a sunbed id/)
  })

  it('{selection:true} uses the page-context ids but DROPS ids of other sites', async () => {
    addParcel(1)
    addParcel(2, { siteId: OTHER_SITE })
    const c = { ...ctx, pageContext: { selection: { itemIds: ['s-20101', 's-10101'] } } } as AssistantToolCtx
    const res = await ok('propose_rotate', { target: { selection: true }, degrees: 90 }, c)
    expect(res.changes.length).toBeGreaterThan(0)
    // Only the in-site seat was resolved: the stored target is exactly that one id.
    expect(payloadOf().ops[0].target).toEqual({ ids: ['s-10101'] })
  })

  it('{selection:true} with only foreign ids / no selection is refused with guidance', async () => {
    addParcel(2, { siteId: OTHER_SITE })
    const c = { ...ctx, pageContext: { selection: { itemIds: ['s-20101'] } } } as AssistantToolCtx
    const a = await refused('propose_rotate', { target: { selection: true }, degrees: 90 }, c)
    expect(a.error ?? a.errors?.join()).toMatch(/Nothing is selected/)
    const b = await refused('propose_rotate', { target: { selection: true }, degrees: 90 })
    expect(b.error ?? b.errors?.join()).toMatch(/Nothing is selected/)
  })

  it('refuses without a session owner of the open site (no proposal)', async () => {
    addParcel(1)
    vi.mocked(auth).mockResolvedValue({ user: { id: 'intruder' } } as never)
    const res = await call('propose_rotate', { target: { parcel: 1 }, degrees: 90 })
    expect(res).toEqual({ ok: false, error: 'forbidden' })
    expect(createProposal).not.toHaveBeenCalled()
  })

  it('a proposal never writes: no action runs while proposing', async () => {
    addParcel(1)
    await ok('propose_rotate', { target: { parcel: 1 }, degrees: 90 })
    await ok('propose_create_parcel', { anchor: { lat: 36.8, lng: -4.5 }, rows: 2, seats_per_row: 4 })
    for (const mod of [actions, parcelOps, inventoryActions]) {
      for (const fn of Object.values(mod)) if (vi.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled()
    }
    expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled()
  })
})

// ─── geometry: preview equals what apply computes ───────────────────────────

describe('preview geometry is computed by the same functions apply uses', () => {
  it('create parcel: the added seats are exactly generateChairs(config), the new number is max+1', async () => {
    addParcel(1)
    await ok('propose_create_parcel', {
      anchor: { lat: 36.8, lng: -4.5 }, rows: 3, seats_per_row: 4, paired: true, horizontal_gap_m: 1.2, vertical_gap_m: 2, rotation: 20,
    })
    const expected = generateChairs({
      group: 2, rows: 3, seatsPerRow: 4, baseLat: 36.8, baseLng: -4.5, horizontalGap: 1.2, verticalGap: 2,
      intraPairGap: 0.4, pairSeats: true, rotation: 20,
    })
    const g = storedGeometry()
    expect(g.mode).toBe('geo')
    expect(g.added).toHaveLength(12)
    expect(g.added.map((a: any) => [a.at.lat, a.at.lng, a.at.rotation, a.parcel])).toEqual(
      expected.map((e) => [parseFloat(e.locationLat), parseFloat(e.locationLng), e.rotation, 2]),
    )
    expect(g.moved).toEqual([])
    expect(g.parcels[0].number).toBe(2)
    expect(g.parcels[0].footprint).toHaveLength(4)
    expect(payloadOf().ops[0]).toMatchObject({ op: 'create_parcel', number: 2 })
    expect(stored().preview.creates[0]).toMatchObject({ target: 'Parcel 2', fields: { sunbeds: 12, rows: 3 } })
  })

  it('create parcel relative_to_parcel: anchor = reference parcel anchor + metres (converted server-side)', async () => {
    addParcel(1)
    await ok('propose_create_parcel', { anchor: { relative_to_parcel: 1, offset_m: { dx: 10, dy: 5 } }, rows: 1, seats_per_row: 2 })
    const d = metresToDelta('geo', 36.7213, 10, 5)
    const first = storedGeometry().added[0].at
    expect(first.lat).toBeCloseTo(36.7213 + d.dy, 9)
    expect(first.lng).toBeCloseTo(-4.4214 + d.dx, 9)
  })

  it('create parcel on a schematic site takes x/y metres and refuses lat/lng (and vice versa)', async () => {
    layoutMode = 'schematic'
    const bad = await refused('propose_create_parcel', { anchor: { lat: 1, lng: 2 }, rows: 1, seats_per_row: 2 })
    expect(bad.errors?.join()).toMatch(/x and y in metres/)
    await ok('propose_create_parcel', { anchor: { x: 20, y: 30 }, rows: 1, seats_per_row: 2 })
    const g = storedGeometry()
    expect(g.mode).toBe('schematic')
    expect(g.added[0].at).toMatchObject({ x: expect.any(Number), y: expect.any(Number) })
    expect(g.added[0].at.lat).toBeUndefined()
    layoutMode = 'geo'
    const bad2 = await refused('propose_create_parcel', { anchor: { x: 1, y: 2 }, rows: 1, seats_per_row: 2 })
    expect(bad2.errors?.join()).toMatch(/lat and lng/)
  })

  it('rotate seats: positions equal rotatePositions over the unit (rotateSelection math), rotation +delta', async () => {
    addParcel(1)
    await ok('propose_rotate', { target: { seats: ['1-1-1'] }, degrees: 90 })
    const unitSeats = seats.filter((s) => s.sunbedGroupId === 'u-1-1-1')
    expect(unitSeats).toHaveLength(2)
    const want = rotatePositions(unitSeats.map((s) => ({ id: s.id, y: parseFloat(s.locationLat), x: parseFloat(s.locationLng), rotation: s.rotation })), 90, 'geo')
    const moved = storedGeometry().moved
    expect(moved.map((m: any) => [m.after.lat, m.after.lng, m.after.rotation])).toEqual(want.map((w) => [w.y, w.x, w.rotation]))
    expect(moved[0].before).toMatchObject({ lat: parseFloat(unitSeats[0]!.locationLat) })
    expect(moved[0].label).toBe('1-1-1-1')
  })

  it('rotate parcel: ItemGroup rotation +delta, whole grid regenerated at the new rotation around the same centre', async () => {
    addParcel(1, { rotation: 30 })
    const before = seats.map((s) => [parseFloat(s.locationLat), parseFloat(s.locationLng)])
    const cLat = before.reduce((a, b) => a + b[0]!, 0) / before.length
    const cLng = before.reduce((a, b) => a + b[1]!, 0) / before.length
    const res = await ok('propose_rotate', { target: { parcel: 1 }, degrees: 90 })
    expect(res.changes).toEqual([expect.objectContaining({ target: 'Parcel 1', field: 'rotation', before: 30, after: 120 })])
    const g = storedGeometry()
    expect(g.moved).toHaveLength(8)
    expect(g.moved.every((m: any) => m.after.rotation === 120)).toBe(true)
    const nLat = g.moved.reduce((a: number, m: any) => a + m.after.lat, 0) / 8
    const nLng = g.moved.reduce((a: number, m: any) => a + m.after.lng, 0) / 8
    expect(nLat).toBeCloseTo(cLat, 9)
    expect(nLng).toBeCloseTo(cLng, 9)
    // The calls apply will make are the existing parcel composition.
    const plan = await simulate(SITE, payloadOf().ops)
    expect(plan.calls).toEqual([{ fn: 'rotateParcel', group: 1, delta: 90 }])
  })

  it('an UNPAIRED parcel stays unpaired in the rotated preview (pairing fix reaches the preview too)', async () => {
    addParcel(1, { paired: false, spr: 4, rows: 1 })
    await ok('propose_rotate', { target: { parcel: 1 }, degrees: 90 })
    // 4 single beds in a row, evenly spaced hGap + bed width apart: no pair spacing pattern.
    const m = storedGeometry().moved
    const pts = m.map((p: any) => [p.after.lat, p.after.lng])
    const sq = (a: number[], b: number[]) => Math.hypot((a[0]! - b[0]!) * 111320, (a[1]! - b[1]!) * 111320 * Math.cos((36.72 * Math.PI) / 180))
    const gaps = [sq(pts[0], pts[1]), sq(pts[1], pts[2]), sq(pts[2], pts[3])]
    expect(gaps[0]).toBeCloseTo(gaps[1]!, 2)
    expect(gaps[1]).toBeCloseTo(gaps[2]!, 2)
  })

  it('move by metres converts to degrees server-side and moves the ItemGroup anchor with the parcel', async () => {
    addParcel(1)
    const res = await ok('propose_move', { target: { parcel: 1 }, by_m: { dx: 0, dy: 10 } })
    const dLat = 10 / 111320
    const plan = await simulate(SITE, payloadOf().ops)
    expect(plan.calls[0]).toMatchObject({ fn: 'moveParcel', group: 1 })
    const call = plan.calls[0] as any
    expect(call.y).toBeCloseTo(36.7213 + dLat, 9)
    expect(call.x).toBeCloseTo(-4.4214, 9)
    expect(storedGeometry().moved).toHaveLength(8)
    expect(storedGeometry().moved[0].after.lat - storedGeometry().moved[0].before.lat).toBeCloseTo(dLat, 9)
    expect(res.changes[0]).toMatchObject({ target: 'Parcel 1', field: 'position' })
  })

  it('move needs exactly one of to / by_m, and `to` follows the layout mode', async () => {
    addParcel(1)
    expect((await refused('propose_move', { target: { parcel: 1 } })).errors?.join()).toMatch(/exactly one/)
    expect((await refused('propose_move', { target: { parcel: 1 }, to: { x: 1, y: 1 }, by_m: { dx: 1, dy: 1 } })).errors?.join()).toMatch(/exactly one/)
    expect((await refused('propose_move', { target: { parcel: 1 }, to: { x: 1, y: 1 } })).errors?.join()).toMatch(/lat and lng/)
    await ok('propose_move', { target: { parcel: 1 }, to: { lat: 36.73, lng: -4.42 } })
  })

  it('spacing both axes: two adjustItemSpacing calls, gaps scaled in the ItemGroup change rows', async () => {
    addParcel(1)
    const res = await ok('propose_spacing', { target: { parcel: 1 }, axis: 'both', factor: 1.5 })
    const plan = await simulate(SITE, payloadOf().ops)
    expect(plan.calls.map((c) => (c as any).axis)).toEqual(['horizontal', 'vertical'])
    expect(res.changes).toEqual([
      expect.objectContaining({ field: 'horizontalGap', before: 1, after: 1.5 }),
      expect.objectContaining({ field: 'verticalGap', before: 1.5, after: 2.25 }),
    ])
    expect((await refused('propose_spacing', { target: { seats: ['1-1-1-1'] }, axis: 'x', factor: 2 })).errors?.join()).toMatch(/at least 2/)
  })

  it('set status: only seats that change are written; a parcel rolls up to one change', async () => {
    addParcel(1)
    seats[0]!.status = 'disabled'
    const res = await ok('propose_set_status', { target: { parcel: 1 }, status: 'disabled' })
    const plan = await simulate(SITE, payloadOf().ops)
    expect((plan.calls[0] as any).ids).toHaveLength(7)
    expect(res.changes).toEqual([expect.objectContaining({ target: 'Parcel 1', field: 'status', before: 'active (7)', after: 'disabled (7)' })])
  })

  it('set status warns (does not cancel) when reservations include the sunbeds', async () => {
    addParcel(1)
    booked = 2
    const res = await ok('propose_set_status', { target: { parcel: 1 }, status: 'disabled' })
    expect(res.warnings.join()).toMatch(/2 reservation/)
  })

  it('reverse orientation turns every bed 180; reverse numbering remaps seat suffixes per row', async () => {
    addParcel(1)
    await ok('propose_reverse', { parcel: 1, what: 'orientation' })
    expect(storedGeometry().moved.every((m: any) => m.after.rotation === (m.before.rotation + 180) % 360)).toBe(true)
    const res = await ok('propose_reverse', { parcel: 1, what: 'numbering' })
    expect(res.changes).toEqual([expect.objectContaining({ field: 'numbering' })])
  })
})

// ─── QR warning ─────────────────────────────────────────────────────────────

describe('QR reprint warning', () => {
  it('reversing the numbering warns with the exact number of affected seats', async () => {
    addParcel(1)
    const res = await ok('propose_reverse', { parcel: 1, what: 'numbering' })
    expect(res.warnings).toContain('QR cards for 8 seats need reprinting')
  })

  it('turning pairing ON for an unpaired parcel changes every unit: all seats are counted', async () => {
    addParcel(1, { paired: false })
    const res = await ok('propose_edit_parcel', { parcel: 1, paired: true })
    expect(res.warnings).toContain('QR cards for 8 seats need reprinting')
  })

  it('growing a parcel keeps existing numbers and units: no reprint warning, the new seats are only "added"', async () => {
    addParcel(1, { rows: 2, spr: 4 })
    const res = await ok('propose_edit_parcel', { parcel: 1, seats_per_row: 6 })
    expect(res.warnings ?? []).toEqual([])
    expect(storedGeometry().added).toHaveLength(4)
  })

  it('moving / rotating / status never warns: labels do not change', async () => {
    addParcel(1)
    for (const [name, input] of [
      ['propose_rotate', { target: { parcel: 1 }, degrees: 45 }],
      ['propose_move', { target: { parcel: 1 }, by_m: { dx: 1, dy: 1 } }],
      ['propose_set_status', { target: { parcel: 1 }, status: 'disabled' }],
    ] as const) {
      const res = await ok(name, input as never)
      expect(res.warnings ?? []).toEqual([])
    }
  })
})

// ─── edit parcel ────────────────────────────────────────────────────────────

describe('propose_edit_parcel', () => {
  it('maps to applyParcelConfig with the editable patch and shows before -> after per field', async () => {
    addParcel(1)
    const res = await ok('propose_edit_parcel', { parcel: 1, horizontal_gap_m: 2, price: 12 })
    const plan = await simulate(SITE, payloadOf().ops)
    expect(plan.calls).toEqual([{ fn: 'applyParcelConfig', group: 1, patch: { horizontalGap: 2, price: 12 } }])
    expect(res.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'horizontalGap', before: 1, after: 2 }),
      expect.objectContaining({ field: 'price', before: 9, after: 12 }),
    ]))
  })

  it('shrinking lists the removed seats as deletes; refused over booked seats and over devices', async () => {
    addParcel(1)
    const res = await ok('propose_edit_parcel', { parcel: 1, seats_per_row: 2 })
    expect(res.deletes).toHaveLength(4)
    expect(storedGeometry().removed).toHaveLength(4)
    booked = 1
    expect(msg(await refused('propose_edit_parcel', { parcel: 1, seats_per_row: 2 }))).toMatch(/reservations/)
    booked = 0
    vi.mocked(devicesBlockingSeatRemoval).mockResolvedValue([{ code: 'D-1', location: '1-1-2' }])
    expect(msg(await refused('propose_edit_parcel', { parcel: 1, seats_per_row: 2 }))).toBe('blocked')
    expect(devicesBlockingSeatRemoval).toHaveBeenCalledWith(SITE, expect.arrayContaining(['s-10103']))
  })

  it('unpairing an already paired parcel is refused; an empty patch is refused', async () => {
    addParcel(1)
    expect(msg(await refused('propose_edit_parcel', { parcel: 1, paired: false }))).toMatch(/Unpairing/)
    expect((await refused('propose_edit_parcel', { parcel: 1 })).errors?.join()).toMatch(/at least one/)
  })

  it('reorder of an UNPAIRED parcel does not re-pair it: the previewed grid equals the unpaired grid', async () => {
    addParcel(1, { paired: false, rows: 1, spr: 4 })
    await ok('propose_edit_parcel', { parcel: 1, horizontal_gap_m: 2 })
    const want = generateChairs({ group: 1, rows: 1, seatsPerRow: 4, baseLat: 36.7213, baseLng: -4.4214, horizontalGap: 2, verticalGap: 1.5, intraPairGap: 0.4, pairSeats: false, rotation: 0 })
    const got = storedGeometry().moved.map((m: any) => m.after.lng)
    const centroid = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    const spread = (xs: number[]) => xs.map((x) => x - centroid(xs))
    spread(got).forEach((v: number, i: number) => expect(v).toBeCloseTo(spread(want.map((w) => parseFloat(w.locationLng)))[i]!, 9))
  })
})

// ─── delete ─────────────────────────────────────────────────────────────────

describe('propose_delete', () => {
  it('lists the deletion, warns it is permanent, and warns about reservations', async () => {
    addParcel(1)
    booked = 3
    const res = await ok('propose_delete', { target: { parcel: 1 } })
    expect(res.deletes).toEqual([{ target: 'Parcel 1', label: '8 sunbed(s)' }])
    expect(res.warnings.join()).toMatch(/3 current or future reservation/)
    expect(res.warnings.join()).toMatch(/cannot be undone/)
    expect(storedGeometry().removed).toHaveLength(8)
    const plan = await simulate(SITE, payloadOf().ops)
    expect(plan.calls).toEqual([{ fn: 'deleteItemsByGroup', group: 1 }])
  })

  it('is refused (not just warned) while a device is mounted on the sunbeds', async () => {
    addParcel(1)
    vi.mocked(devicesBlockingSeatRemoval).mockResolvedValue([{ code: 'D-7', location: '1-1-1' }])
    expect(msg(await refused('propose_delete', { target: { parcel: 1 } }))).toBe('blocked')
    expect(devicesBlockingSeatRemoval).toHaveBeenCalledWith(SITE, expect.arrayContaining(['s-10101', 's-10204']))
  })

  it('deleting is not undoable: the lifecycle sees deletes and no changes', async () => {
    addParcel(1)
    await ok('propose_delete', { target: { seats: ['1-1-1-1'] } })
    expect(stored().preview.changes).toEqual([])
    expect(stored().preview.deletes).toHaveLength(1)
  })

  it('cannot be mixed with other ops in one proposal', async () => {
    addParcel(1)
    const { planInventory } = await import('./handlers/inventory')
    const plan = await planInventory(SITE, [{ op: 'rotate', target: { parcel: 1 }, degrees: 10 }, { op: 'delete', target: { parcel: 1 } }])
    expect('errors' in plan && plan.errors[0]).toMatch(/on its own/)
  })
})

// ─── batches, stale check, execute, undo ────────────────────────────────────

describe('batch semantics', () => {
  it('ops apply in order against the evolving state: create a parcel, then rotate the NEW parcel', async () => {
    const { planInventory } = await import('./handlers/inventory')
    const ops = [
      { op: 'create_parcel', number: 1, anchor: { y: 36.8, x: -4.5 }, rows: 1, seatsPerRow: 4, paired: true, horizontalGap: 1, verticalGap: 1.5, rotation: 0 },
      { op: 'rotate', target: { parcel: 1 }, degrees: 90 },
    ] as never
    const plan = await planInventory(SITE, ops)
    expect('payload' in plan).toBe(true)
    const sim = await simulate(SITE, ops)
    expect(sim.calls.map((c) => c.fn)).toEqual(['sync', 'rotateParcel'])
    // The previewed seats are the ROTATED grid, not the unrotated one.
    const rotated = generateChairs({ group: 1, rows: 1, seatsPerRow: 4, baseLat: 36.8, baseLng: -4.5, horizontalGap: 1, verticalGap: 1.5, intraPairGap: 0.4, pairSeats: true, rotation: 90 })
    expect(sim.diff.geometry!.added.every((a) => a.at.rotation === 90)).toBe(true)
    expect(sim.diff.geometry!.added).toHaveLength(rotated.length)
  })

  it('two ops on the same parcel compose: rotate 30 then 60 equals one rotation of 90 in the ItemGroup', async () => {
    addParcel(1)
    const { planInventory } = await import('./handlers/inventory')
    const plan = await planInventory(SITE, [
      { op: 'rotate', target: { parcel: 1 }, degrees: 30 },
      { op: 'rotate', target: { parcel: 1 }, degrees: 60 },
    ])
    expect('payload' in plan).toBe(true)
    const sim = await simulate(SITE, (plan as any).payload.ops)
    expect(sim.diff.changes.map((c) => [c.before, c.after])).toEqual([[0, 30], [30, 90]])
    expect(sim.calls).toEqual([{ fn: 'rotateParcel', group: 1, delta: 30 }, { fn: 'rotateParcel', group: 1, delta: 60 }])
  })
})

describe('stale check', () => {
  it('apply: the diff basis changes when ANY loaded seat position, rotation, status or number changed', async () => {
    addParcel(1)
    await ok('propose_rotate', { target: { parcel: 1 }, degrees: 90 })
    const ops = payloadOf().ops
    const base = diffBasis(await inventoryHandler.diff(hctx, { ops }))
    expect(diffBasis(await inventoryHandler.diff(hctx, { ops }))).toBe(base)
    for (const mutate of [
      (s: Row) => { s.locationLat = String(parseFloat(s.locationLat) + 1e-6) },
      (s: Row) => { s.rotation = 5 },
      (s: Row) => { s.status = 'disabled' },
      (s: Row) => { s.number += 100 },
    ]) {
      const snap = JSON.parse(JSON.stringify(seats))
      mutate(seats[3]!)
      expect(diffBasis(await inventoryHandler.diff(hctx, { ops }))).not.toBe(base)
      seats = snap
    }
    igs[0]!.horizontalGap = 3
    expect(diffBasis(await inventoryHandler.diff(hctx, { ops }))).not.toBe(base)
  })

  it('undo: empty diff while the touched seats still equal the applied after-state, non-empty once one moved', async () => {
    addParcel(1)
    await ok('propose_rotate', { target: { seats: ['1-1-1'] }, degrees: 90 })
    const payload = payloadOf()
    // Simulate "apply": write the expected after-state into the fake table.
    for (const [id, y, x, rot, status, number, group] of payload.expect.seats) {
      const s = seats.find((r) => r.id === id)!
      Object.assign(s, { locationLat: String(y), locationLng: String(x), rotation: rot, status, number, group })
    }
    expect((await inventoryHandler.diff(hctx, payload, { applied: true })).changes).toEqual([])
    seats.find((r) => r.id === payload.expect.seats[0][0])!.locationLat = '10'
    expect((await inventoryHandler.diff(hctx, payload, { applied: true })).changes.length).toBeGreaterThan(0)
  })
})

describe('execute = the planned calls through the existing actions, in order', () => {
  it('rotate parcel, edit, move, status, reverse and spacing map to their actions with site-scoped args', async () => {
    addParcel(1)
    const run = async (name: string, input: Record<string, unknown>) => {
      await ok(name, input)
      const done: string[] = []
      await inventoryHandler.execute(hctx, payloadOf(), done)
      return done
    }
    vi.mocked(actions.moveParcel).mockResolvedValue({ status: 'ok' } as never)
    for (const fn of [actions.syncChairsWithLayout, actions.moveItems, actions.rotateSelection, actions.adjustItemSpacing, actions.reverseParcelNumbering, actions.reverseParcelOrientation, parcelOps.applyParcelConfig, parcelOps.rotateParcel, parcelOps.rotateUnit, parcelOps.setSeatsStatus]) {
      vi.mocked(fn as never as (...a: unknown[]) => unknown).mockResolvedValue({ status: 'ok' } as never)
    }

    expect(await run('propose_rotate', { target: { parcel: 1 }, degrees: 45 })).toEqual(['1:rotateParcel'])
    expect(parcelOps.rotateParcel).toHaveBeenCalledWith(SITE, 1, 45)
    await run('propose_edit_parcel', { parcel: 1, horizontal_gap_m: 2 })
    expect(parcelOps.applyParcelConfig).toHaveBeenCalledWith(SITE, 1, { horizontalGap: 2 })
    await run('propose_set_status', { target: { parcel: 1 }, status: 'disabled' })
    expect(vi.mocked(parcelOps.setSeatsStatus).mock.calls[0]![0]).toBe(SITE)
    await run('propose_reverse', { parcel: 1, what: 'numbering' })
    expect(actions.reverseParcelNumbering).toHaveBeenCalledWith(SITE, 1)
    await run('propose_spacing', { target: { parcel: 1 }, axis: 'x', factor: 2 })
    expect(vi.mocked(actions.adjustItemSpacing).mock.calls[0]!.slice(0, 1)).toEqual([SITE])
    await run('propose_move', { target: { seats: ['1-1-1-1', '1-1-1-2'] }, by_m: { dx: 1, dy: 0 } })
    expect(vi.mocked(actions.moveItems).mock.calls[0]![0]).toBe(SITE)
    await run('propose_create_parcel', { anchor: { lat: 36.9, lng: -4.5 }, rows: 1, seats_per_row: 2 })
    expect(vi.mocked(actions.syncChairsWithLayout).mock.calls[0]![2]).toBe('create')
    expect(vi.mocked(actions.syncChairsWithLayout).mock.calls[0]![1]).toMatchObject({ group: 2, baseLat: 36.9, baseLng: -4.5 })
  })

  it('stops at the first failing action with its message and the finished steps', async () => {
    addParcel(1)
    await ok('propose_rotate', { target: { parcel: 1 }, degrees: 45 })
    vi.mocked(parcelOps.rotateParcel).mockResolvedValue({ status: 'error', errors: ['boom'] } as never)
    const done: string[] = []
    await expect(inventoryHandler.execute(hctx, payloadOf(), done)).rejects.toMatchObject({ message: 'boom' })
    expect(done).toEqual([])
  })

  it('an unauthorised caller executes nothing (requireSiteOwner is re-checked)', async () => {
    addParcel(1)
    await ok('propose_rotate', { target: { parcel: 1 }, degrees: 45 })
    vi.mocked(auth).mockResolvedValue({ user: { id: 'intruder' } } as never)
    await expect(inventoryHandler.execute(hctx, payloadOf(), [])).rejects.toMatchObject({ message: 'Not authorized' })
    expect(parcelOps.rotateParcel).not.toHaveBeenCalled()
  })
})

describe('snapshot / undo', () => {
  const snapshotFor = async (name: string, input: Record<string, unknown>) => {
    await ok(name, input)
    return { payload: payloadOf(), snapshot: await inventoryHandler.snapshot(hctx, payloadOf()) }
  }

  it('snapshot captures position, rotation, status, number, parcel, ItemGroup and unit of the touched seats', async () => {
    addParcel(1)
    const { snapshot } = await snapshotFor('propose_rotate', { target: { parcel: 1 }, degrees: 90 })
    expect(snapshot.seats).toHaveLength(8)
    expect(snapshot.seats[0]).toMatchObject({
      id: 's-10101', number: 10101, group: 1, status: 'active', rotation: 0,
      locationLat: expect.any(String), itemGroupId: 'ig-1', sunbedGroupId: 'u-1-1-1',
    })
    expect(snapshot.itemGroups).toEqual([expect.objectContaining({ id: 'ig-1', rotation: 0, horizontalGap: 1, verticalGap: 1.5 })])
    expect(snapshot.units.map((u) => u.id).sort()).toEqual(['u-1-1-1', 'u-1-1-2', 'u-1-2-1', 'u-1-2-2'])
  })

  it('restore writes the snapshot back per seat (site-scoped), restores the ItemGroup, recomputes labels', async () => {
    addParcel(1)
    const { payload, snapshot } = await snapshotFor('propose_rotate', { target: { parcel: 1 }, degrees: 90 })
    vi.mocked(prisma.inventoryItem.updateMany).mockResolvedValue({ count: 1 } as never)
    await inventoryHandler.restore(hctx, payload, snapshot)
    const writes = vi.mocked(prisma.inventoryItem.updateMany).mock.calls.map((c) => c[0] as any)
    expect(writes).toHaveLength(8)
    expect(writes[0]).toEqual({
      where: { id: 's-10101', siteId: SITE },
      data: expect.objectContaining({ rotation: 0, status: 'active', number: 10101, group: 1, itemGroupId: 'ig-1', sunbedGroupId: 'u-1-1-1', locationLat: snapshot.seats[0]!.locationLat }),
    })
    expect(prisma.itemGroup.updateMany).toHaveBeenCalledWith({ where: { id: 'ig-1' }, data: expect.objectContaining({ rotation: 0, horizontalGap: 1 }) })
    expect(recomputeSeatLabels).toHaveBeenCalledWith(SITE)
  })

  it('undo of a created parcel deletes the created seats; blocked ("in_use") when they carry reservations or devices', async () => {
    const { payload, snapshot } = await snapshotFor('propose_create_parcel', { anchor: { lat: 36.9, lng: -4.5 }, rows: 1, seats_per_row: 2 })
    // "apply" happened: the 2 new seats of the new parcel (number 1 on an empty site) exist.
    seats.push(
      { id: 'n1', siteId: SITE, number: 10101, group: 1, status: 'active', itemGroupId: 'ig-new', sunbedGroupId: 'un1' },
      { id: 'n2', siteId: SITE, number: 10102, group: 1, status: 'active', itemGroupId: 'ig-new', sunbedGroupId: 'un1' },
    )
    expect(await inventoryHandler.undoBlocker!(hctx, payload, snapshot)).toBeNull()
    vi.mocked(inventoryActions.deleteInventoryItems).mockResolvedValue({ status: 'ok' } as never)
    await inventoryHandler.restore(hctx, payload, snapshot)
    expect(inventoryActions.deleteInventoryItems).toHaveBeenCalledWith(SITE, ['n1', 'n2'])
    expect(prisma.itemGroup.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['ig-new'] }, items: { none: {} } } })

    booked = 1
    expect(await inventoryHandler.undoBlocker!(hctx, payload, snapshot)).toMatch(/reservation/)
    booked = 0
    vi.mocked(devicesBlockingSeatRemoval).mockResolvedValue([{ code: 'D-9', location: '2-1-1' }])
    expect(await inventoryHandler.undoBlocker!(hctx, payload, snapshot)).toBe('blocked')
  })

  it('undo is blocked when the change removed seats (a shrink): they cannot be restored', async () => {
    addParcel(1)
    const { payload, snapshot } = await snapshotFor('propose_edit_parcel', { parcel: 1, seats_per_row: 2 })
    seats = seats.filter((s) => !['s-10103', 's-10104', 's-10203', 's-10204'].includes(s.id))
    expect(await inventoryHandler.undoBlocker!(hctx, payload, snapshot)).toMatch(/4 sunbed\(s\) were removed/)
  })
})

// ─── request_qr_print ───────────────────────────────────────────────────────

describe('request_qr_print', () => {
  it('emits the qr_print event for a parcel and returns the print target without proposing anything', async () => {
    addParcel(1)
    const res = await ok('request_qr_print', { target: { parcel: 1 } })
    expect(res.printTarget).toEqual({ parcel: 1 })
    expect(emit).toHaveBeenCalledWith('qr_print', { parcel: 1 })
    expect(createProposal).not.toHaveBeenCalled()
  })

  it('resolves seat ids in-site, sends stored labels + display ids, refuses a foreign / unknown parcel', async () => {
    addParcel(1)
    addParcel(2, { siteId: OTHER_SITE })
    const res = await ok('request_qr_print', { target: { seats: ['1-1-1'] } })
    expect(res.printTarget.seatIds).toEqual(['1-1-1-1', '1-1-1-2'])
    expect(emit).toHaveBeenLastCalledWith('qr_print', { seatLabels: ['1-101-1', '1-101-2'], seatIds: ['1-1-1-1', '1-1-1-2'] })
    expect((await call('request_qr_print', { target: { parcel: 2 } })).error).toBe('parcel_not_found')
    expect((await call('request_qr_print', { target: { seats: ['2-1-1-1'] } })).error).toBe('seats_not_found')
    expect((await call('request_qr_print', { target: {} })).ok).toBe(false)
  })
})
