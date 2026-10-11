/**
 * `run_js` (track 030 G4): the tool feeds the sandbox ONLY the route-bound site's data rows (read through the DB-enforced reader) and
 * scene, and a script's `proposal` is strictly re-parsed (inventory ops only, no delete, parcels by
 * number within the site, <= 50 ops) before it goes through the normal propose path.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('@repo/data/assistant-claim', () => ({ runAssistantSql: vi.fn() }))
vi.mock('./spatial-data', () => ({ loadSiteBase: vi.fn(), loadElements: vi.fn().mockResolvedValue([]), seatLocal: vi.fn() }))
vi.mock('./spatial', () => ({ shoreScene: vi.fn() }))
vi.mock('../proposals/handlers/inventory', () => ({ inventoryHandler: { kind: 'inventory_batch' }, planInventory: vi.fn() }))
vi.mock('../proposals/act', () => ({ createAndApply: vi.fn() }))

import { executeToolCall } from '@repo/agent/loop'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { runAssistantSql } from '@repo/data/assistant-claim'
import { createAndApply } from '../proposals/act'
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

/** Stand-in for the DB-enforced reader: serves only the CLAIMED site's rows, like the real views. */
const SEATS: Record<string, string[]> = { [A]: ['1-101-1', '1-101-2'], [B]: ['9-999-9'] }
function fakeReader(sql: string, _p: readonly unknown[], c: { siteId: string; accountId: string; maxRows?: number }) {
  const m = /FROM assistant\.(\w+)/.exec(sql)!
  if (m[1] === 'sunbed' && /count\(\*\)/.test(sql)) return Promise.resolve({ columns: ['n'], rows: [[SEATS[c.siteId]!.length]], truncated: false })
  if (m[1] === 'sunbed') return Promise.resolve({ columns: ['id', 'seat_label'], rows: SEATS[c.siteId]!.map((l, i) => [`id${i}`, l]), truncated: false })
  return Promise.resolve({ columns: ['name'], rows: [], truncated: false })
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
  process.env.ASSISTANT_DB_URL = 'postgres://reader@localhost/x'
  process.env.ASSISTANT_DB_CLAIM_SECRET = 'x'.repeat(40)
  vi.mocked(runAssistantSql).mockImplementation(fakeReader as never)
  vi.mocked(planInventory).mockImplementation(async (_s, ops) => ({ payload: { ops } }))
  vi.mocked(createAndApply).mockResolvedValue({ ok: true, applied: true, appliedAt: 1, card: { actionId: 'act-1', summary: 'Move 2 parcels', preview: { changes: [{ label: 'Parcel 1' }] } } } as never)
})

afterAll(() => {
  delete process.env.ASSISTANT_DB_URL
  delete process.env.ASSISTANT_DB_CLAIM_SECRET
})

describe('run_js tool: inputs', () => {
  it('reads only the ctx site: view rows through the claimed reader, and the scene', async () => {
    const r = await call({ purpose: 'labels', code: 'return { labels: data.sunbed.map((s) => s.seat_label), keys: Object.keys(data.sunbed[0]).sort(), tables: Object.keys(data), parcels: scene.parcels.map((p) => p.number) }' })
    expect(r.ok).toBe(true)
    expect(r.result.labels).toEqual(['1-101-1', '1-101-2'])
    expect(r.result.keys).toEqual(['id', 'seat_label'])
    expect(r.result.tables).toEqual(['sunbed'])
    expect(r.result.parcels).toEqual([1, 2])
    expect(vi.mocked(runAssistantSql)).toHaveBeenCalled()
    // The claim is the route-bound site + owner account, never anything from the script.
    expect(vi.mocked(runAssistantSql).mock.calls.every(([, , c]) => c.siteId === A && c.accountId === OWNER)).toBe(true)
    expect(vi.mocked(runAssistantSql).mock.calls[0]![0]).toMatch(/^SELECT \* FROM assistant\.sunbed LIMIT 5000$/)
    expect(vi.mocked(loadSiteBase)).toHaveBeenCalledWith(A)
  })

  it('does not touch the database when the script names no table', async () => {
    const r = await call({ purpose: 'gap', code: 'const [a, b] = scene.parcels; return geo.polygonGap(a.corners, b.corners)' })
    expect(r).toMatchObject({ ok: true, result: 6 })
    expect(runAssistantSql).not.toHaveBeenCalled()
  })

  it('returns sandbox errors (timeout) as a tool result', async () => {
    const r = await call({ purpose: 'loop', code: 'while (true) {}' })
    expect(r).toMatchObject({ ok: false, error: 'timeout' })
  })

  it('is refused for a non-owner before anything is read', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: 'someone-else' } as never)
    const r = await call({ purpose: 'x', code: 'return data.sunbed' })
    expect(r).toEqual({ ok: false, error: 'forbidden' })
    expect(runAssistantSql).not.toHaveBeenCalled()
  })
})

describe('run_js tool: data access switch', () => {
  it('without ASSISTANT_DB_URL the data tables are empty and the script is told why, instead of throwing', async () => {
    delete process.env.ASSISTANT_DB_URL
    const r = await call({ purpose: 'x', code: 'return data.sunbed.length' })
    expect(r).toMatchObject({ ok: true, result: 0, notes: [expect.stringContaining('data_access_not_configured')] })
    expect(runAssistantSql).not.toHaveBeenCalled()
  })

  it('a view that fails to read is reported and left empty, the script still runs', async () => {
    vi.mocked(runAssistantSql).mockRejectedValue(Object.assign(new Error('permission denied for view sunbed'), { code: '42501' }))
    const r = await call({ purpose: 'x', code: 'return data.sunbed.length' })
    expect(r).toMatchObject({ ok: true, result: 0, notes: [expect.stringContaining('data.sunbed could not be read')] })
  })

  it('reports truncation with the real total when a view exceeds the cap', async () => {
    vi.mocked(runAssistantSql).mockImplementation(((sql: string) =>
      /count\(\*\)/.test(sql)
        ? Promise.resolve({ columns: ['n'], rows: [[7000]], truncated: false })
        : Promise.resolve({ columns: ['id'], rows: Array.from({ length: 5000 }, (_, i) => [`i${i}`]), truncated: false })) as never)
    const r = await call({ purpose: 'x', code: 'return data.sunbed.length' })
    expect(r).toMatchObject({ ok: true, result: 5000, dataTruncated: { sunbed: { loaded: 5000, total: 7000 } } })
  })
})

describe('run_js tool: script proposals', () => {
  it('turns a valid script proposal into an inventory change APPLIED straight away (local metres, parcel numbers)', async () => {
    const r = await call({
      purpose: 'space evenly',
      code: `const ops = scene.parcels.map((p, i) => ({ op: 'move', target: { parcel: p.number }, by: { dx: i * 2, dy: 0 } }));
             ops.push({ op: 'move', target: { parcel: 1 }, to: { x: 100, y: 50 } });
             return { moved: ops.length, proposal: { summary: 'Spread parcels', ops } }`,
    })
    expect(r.ok).toBe(true)
    expect(r.result).toEqual({ moved: 3, proposal: '(see proposal)' })
    expect(r.proposal).toMatchObject({ ok: true, actionId: 'act-1', status: 'applied', ops: 3, scriptSummary: 'Spread parcels' })
    const ops = vi.mocked(planInventory).mock.calls[0]![1]
    expect(vi.mocked(planInventory).mock.calls[0]![0]).toBe(A)
    expect(ops[0]).toEqual({ op: 'move', target: { parcel: 1 }, by: { dx: 0, dy: 0 } })
    // `to` arrives in the site's own coordinates (lat/lng as y/x), converted from local metres.
    const to = (ops[2] as { to: { y: number; x: number } }).to
    const back = toLocal(frame as Frame, { lat: to.y, lng: to.x })!
    expect(back.x).toBeCloseTo(100, 6)
    expect(back.y).toBeCloseTo(50, 6)
    expect(createAndApply).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createAndApply).mock.calls[0]![0]).toBe(ctx)
  })

  it('rejects a bad proposal without proposing anything', async () => {
    const r = await call({ purpose: 'del', code: `return { proposal: { ops: [{ op: 'delete', target: { parcel: 1 } }] } }` })
    expect(r.proposal).toMatchObject({ ok: false })
    expect(r.proposal.errors[0]).toMatch(/cannot delete/)
    expect(planInventory).not.toHaveBeenCalled()
    expect(createAndApply).not.toHaveBeenCalled()
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
