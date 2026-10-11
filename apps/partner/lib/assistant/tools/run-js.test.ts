/**
 * `run_js` (track 030 G4): the tool feeds the sandbox ONLY the route-bound site's snapshot rows and
 * scene, and a script's `proposal` is strictly re-parsed (inventory ops only, no delete, parcels by
 * number within the site, <= 50 ops) before it goes through the normal propose path.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('../snapshot/load', () => ({ getSnapshot: vi.fn() }))
vi.mock('./spatial-data', () => ({ loadSiteBase: vi.fn(), loadElements: vi.fn().mockResolvedValue([]), seatLocal: vi.fn() }))
vi.mock('./spatial', () => ({ shoreScene: vi.fn() }))
vi.mock('../proposals/handlers/inventory', () => ({ inventoryHandler: { kind: 'inventory_batch' }, planInventory: vi.fn() }))
vi.mock('../proposals/create', () => ({ createProposalFor: vi.fn() }))

import type { PGlite } from '@electric-sql/pglite'
import { executeToolCall } from '@repo/agent/loop'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getSnapshot } from '../snapshot/load'
import { createProposalFor } from '../proposals/create'
import { planInventory } from '../proposals/handlers/inventory'
import { geoFrame, toLocal, type Frame } from '../geo/frame'
import { parseScriptProposal, MAX_SCRIPT_OPS, type ScriptSiteCtx } from '../sandbox/script-proposal'
import { loadSiteBase } from './spatial-data'
import { runJsTool } from './run-js'
import type { AssistantToolCtx } from './helpers'

const OWNER = 'owner-1'
const A = 'site-a'
const B = 'site-b'
const ctx: AssistantToolCtx = { session: {}, accountId: OWNER, siteId: A, locale: 'en', conversationId: 'conv-1' }
const frame = geoFrame({ lat: 39.5, lng: 2.6 })

const square = (cx: number, cy: number) => [
  { x: cx - 2, y: cy - 1 }, { x: cx + 2, y: cy - 1 }, { x: cx + 2, y: cy + 1 }, { x: cx - 2, y: cy + 1 },
]
const parcel = (group: number, cx: number) => ({
  summary: { group, count: 4, itemGroupId: `ig${group}`, rows: 1, seatsPerRow: 4, horizontalGap: 1, verticalGap: 1.5, pairGap: 0.4, rotation: 0, locationLat: null, locationLng: null, schematicX: null, schematicY: null, category: null, price: null },
  shape: { localCorners: [], localCentre: { x: 0, y: 0 }, anchor: { lat: 39.5, lng: 2.6 + cx / frame.perLng! }, sizeM: { alongRows: 4, acrossRows: 2 }, rowBearingDegrees: 90 },
  poly: square(cx, 0),
})

// Real PGlite snapshots per site, built from mapped rows (two tenants with different seats).
const dbs: Record<string, PGlite> = {}
async function snapshotFor(site: string, labels: string[]) {
  const { buildDatabase } = await vi.importActual<typeof import('../snapshot/load')>('../snapshot/load')
  const rows = {
    site: [{ name: site }], parcel: [], seat: labels.map((l, i) => ({ id: i + 1, number: i + 1, seat_label: l, parcel: 1, status: 'active', secret_extra: 'LEAK' })),
    layout_element: [], product: [], rental_item: [], working_hours: [], reservation: [], reservation_seat: [], food_order: [],
    food_order_item: [], invoice: [], snapshot_info: [],
  }
  dbs[site] = await buildDatabase(rows as never, 'UTC')
}

async function call(input: Record<string, unknown>, c: AssistantToolCtx = ctx) {
  const ex = await executeToolCall([runJsTool], { id: 't1', name: 'run_js', arguments: JSON.stringify(input) }, c)
  expect(ex.errors).toEqual([])
  return ex.result as Record<string, any>
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(auth).mockResolvedValue({ user: { id: OWNER } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as never)
  vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER } as never)
  vi.mocked(prisma.inventoryItem.aggregate).mockResolvedValue({ _max: { group: 2 } } as never)
  vi.mocked(loadSiteBase).mockResolvedValue({ ok: true, mode: 'geo', frame, origin: { lat: 39.5, lng: 2.6 }, parcels: [parcel(1, 0), parcel(2, 10)], parcelsWithoutGeometry: [] } as never)
  if (!dbs[A]) await snapshotFor(A, ['1-101-1', '1-101-2'])
  if (!dbs[B]) await snapshotFor(B, ['9-999-9'])
  vi.mocked(getSnapshot).mockImplementation(async (siteId: string) => ({ db: dbs[siteId]!, siteId, loadedAt: new Date(), fingerprint: '', loadMs: 0, counts: {} }) as never)
  vi.mocked(planInventory).mockImplementation(async (_s, ops) => ({ payload: { ops } }))
  vi.mocked(createProposalFor).mockResolvedValue({ ok: true, card: { actionId: 'act-1', summary: 'Move 2 parcels', preview: { changes: [{ label: 'Parcel 1' }] } } } as never)
})

afterAll(async () => {
  await Promise.all(Object.values(dbs).map((d) => d.close()))
})

describe('run_js tool: inputs', () => {
  it('reads only the ctx site: snapshot rows (allowlisted columns) and scene', async () => {
    const r = await call({ purpose: 'labels', code: 'return { labels: data.seat.map((s) => s.seat_label), keys: Object.keys(data.seat[0]).sort(), tables: Object.keys(data), parcels: scene.parcels.map((p) => p.number) }' })
    expect(r.ok).toBe(true)
    expect(r.result.labels).toEqual(['1-101-1', '1-101-2'])
    expect(r.result.keys).not.toContain('secret_extra')
    expect(r.result.tables).toEqual(['seat'])
    expect(r.result.parcels).toEqual([1, 2])
    expect(vi.mocked(getSnapshot).mock.calls.every(([s]) => s === A)).toBe(true)
    expect(vi.mocked(loadSiteBase)).toHaveBeenCalledWith(A)
  })

  it('does not build a snapshot when the script names no table', async () => {
    const r = await call({ purpose: 'gap', code: 'const [a, b] = scene.parcels; return geo.polygonGap(a.corners, b.corners)' })
    expect(r).toMatchObject({ ok: true, result: 6 })
    expect(getSnapshot).not.toHaveBeenCalled()
  })

  it('returns sandbox errors (timeout) as a tool result', async () => {
    const r = await call({ purpose: 'loop', code: 'while (true) {}' })
    expect(r).toMatchObject({ ok: false, error: 'timeout' })
  })

  it('is refused for a non-owner before anything is read', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: 'someone-else' } as never)
    const r = await call({ purpose: 'x', code: 'return data.seat' })
    expect(r).toEqual({ ok: false, error: 'forbidden' })
    expect(getSnapshot).not.toHaveBeenCalled()
  })
})

describe('run_js tool: script proposals', () => {
  it('turns a valid proposal into a normal inventory proposal (local metres, parcel numbers)', async () => {
    const r = await call({
      purpose: 'space evenly',
      code: `const ops = scene.parcels.map((p, i) => ({ op: 'move', target: { parcel: p.number }, by: { dx: i * 2, dy: 0 } }));
             ops.push({ op: 'move', target: { parcel: 1 }, to: { x: 100, y: 50 } });
             return { moved: ops.length, proposal: { summary: 'Spread parcels', ops } }`,
    })
    expect(r.ok).toBe(true)
    expect(r.result).toEqual({ moved: 3, proposal: '(see proposal)' })
    expect(r.proposal).toMatchObject({ ok: true, actionId: 'act-1', status: 'proposed', ops: 3, scriptSummary: 'Spread parcels' })
    const ops = vi.mocked(planInventory).mock.calls[0]![1]
    expect(vi.mocked(planInventory).mock.calls[0]![0]).toBe(A)
    expect(ops[0]).toEqual({ op: 'move', target: { parcel: 1 }, by: { dx: 0, dy: 0 } })
    // `to` arrives in the site's own coordinates (lat/lng as y/x), converted from local metres.
    const to = (ops[2] as { to: { y: number; x: number } }).to
    const back = toLocal(frame as Frame, { lat: to.y, lng: to.x })!
    expect(back.x).toBeCloseTo(100, 6)
    expect(back.y).toBeCloseTo(50, 6)
    expect(createProposalFor).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createProposalFor).mock.calls[0]![0]).toBe(ctx)
  })

  it('rejects a bad proposal without proposing anything', async () => {
    const r = await call({ purpose: 'del', code: `return { proposal: { ops: [{ op: 'delete', target: { parcel: 1 } }] } }` })
    expect(r.proposal).toMatchObject({ ok: false })
    expect(r.proposal.errors[0]).toMatch(/cannot delete/)
    expect(planInventory).not.toHaveBeenCalled()
    expect(createProposalFor).not.toHaveBeenCalled()
  })
})

describe('parseScriptProposal', () => {
  const sc: ScriptSiteCtx = { frame, parcels: new Set([1, 2, 3]), nextParcelNumber: 4 }
  const errs = (p: unknown) => {
    const r = parseScriptProposal(p, sc)
    expect('errors' in r).toBe(true)
    return (r as { errors: string[] }).errors.join(' ')
  }

  it('rejects malformed ops', () => {
    expect(errs({ ops: [{ op: 'move', target: { parcel: 1 } }] })).toMatch(/exactly one of by/)
    expect(errs({ ops: [{ op: 'move', target: { parcel: 1 }, by: { dx: 'far', dy: 0 } }] })).toMatch(/by.dx/)
    expect(errs({ ops: [{ op: 'move', target: { parcel: 1 }, by: { dx: 1, dy: 0 }, id: 'cuid' }] })).toMatch(/unknown field/)
    expect(errs({ ops: [{ op: 'rotate', target: { ids: ['x'] }, degrees: 5 }] })).toMatch(/unknown field/)
    expect(errs({ ops: [{ op: 'teleport' }] })).toMatch(/op must be one of/)
    expect(errs({ ops: [{ op: 'spacing', target: { parcel: 1 }, axis: 'z', factor: 2 }] })).toMatch(/axis/)
    expect(errs({ ops: [{ op: 'edit_parcel', parcel: 1 }] })).toMatch(/at least one field/)
    expect(errs({ ops: [] })).toMatch(/non-empty/)
    expect(errs({ ops: [{ op: 'move', target: { parcel: 1 }, by: { dx: 1, dy: 1 } }], extra: 1 })).toMatch(/unknown field/)
  })

  it('rejects delete', () => {
    expect(errs({ ops: [{ op: 'delete', target: { parcel: 1 } }] })).toMatch(/cannot delete/)
  })

  it('rejects parcels that are not on this site', () => {
    expect(errs({ ops: [{ op: 'move', target: { parcel: 77 }, by: { dx: 1, dy: 1 } }] })).toMatch(/parcel 77 does not exist on this site/)
    expect(errs({ ops: [{ op: 'reverse', parcel: 9, what: 'numbering' }] })).toMatch(/parcel 9/)
    expect(errs({ ops: [{ op: 'set_status', target: { seats: ['9-1-1-1'] }, status: 'disabled' }] })).toMatch(/does not exist on this site/)
    expect(errs({ ops: [{ op: 'create_parcel', anchor: { relative_to_parcel: 50, offset_m: { dx: 1, dy: 0 } }, rows: 1, seats_per_row: 2 }] })).toMatch(/parcel 50/)
  })

  it(`rejects more than ${MAX_SCRIPT_OPS} ops`, () => {
    const ops = Array.from({ length: MAX_SCRIPT_OPS + 1 }, () => ({ op: 'rotate', target: { parcel: 1 }, degrees: 1 }))
    expect(errs({ ops })).toMatch(/at most 50/)
    expect('ops' in parseScriptProposal({ ops: ops.slice(0, MAX_SCRIPT_OPS) }, sc)).toBe(true)
  })

  it('maps every allowed op onto the InvOp union', () => {
    const r = parseScriptProposal({
      summary: 's',
      ops: [
        { op: 'create_parcel', anchor: { x: 0, y: 0 }, rows: 2, seats_per_row: 3, paired: false },
        { op: 'create_parcel', anchor: { relative_to_parcel: 1, offset_m: { dx: 5, dy: 0 } }, rows: 1, seats_per_row: 4, rotation: 10 },
        { op: 'edit_parcel', parcel: 2, seats_per_row: 6, paired: true },
        { op: 'rotate', target: { seats: ['1-1-1-1'] }, degrees: -15 },
        { op: 'spacing', target: { parcel: 3 }, axis: 'both', factor: 1.2 },
        { op: 'set_status', target: { parcel: 3 }, status: 'disabled' },
        { op: 'reverse', parcel: 1, what: 'orientation' },
      ],
    }, sc)
    if ('errors' in r) throw new Error(r.errors.join())
    expect(r.ops.map((o) => o.op)).toEqual(['create_parcel', 'create_parcel', 'edit_parcel', 'rotate', 'spacing', 'set_status', 'reverse'])
    expect(r.ops[0]).toMatchObject({ number: 4, anchor: { y: 39.5, x: 2.6 }, rows: 2, seatsPerRow: 3, paired: false, horizontalGap: 1, verticalGap: 1.5 })
    expect(r.ops[1]).toMatchObject({ number: 5, anchor: { relativeTo: 1, dx: 5, dy: 0 }, rotation: 10, paired: true })
    expect(r.ops[2]).toEqual({ op: 'edit_parcel', parcel: 2, patch: { seatsPerRow: 6, pairSeats: true } })
  })
})
