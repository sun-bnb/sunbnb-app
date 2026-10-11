/**
 * Schematic layout proposals (track 030 S4c), unit level: an in-memory element table stands in for
 * Postgres and the REAL create/update/delete bodies are replaced by mocks that mutate it, so the test
 * asserts preview == what the actions would write, handle scoping, bounds warnings and undo.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@repo/data/assistant', () => ({ createProposal: vi.fn() }))
vi.mock('@/app/sites/[id]/schematic/actions', () => ({ createLayoutElement: vi.fn(), updateLayoutElement: vi.fn(), deleteLayoutElement: vi.fn() }))
vi.mock('@/app/sites/[id]/site-actions', () => ({ saveLayoutDimensions: vi.fn() }))

import { executeToolCall } from '@repo/agent/loop'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { createProposal } from '@repo/data/assistant'
import * as schematic from '@/app/sites/[id]/schematic/actions'
import * as siteActions from '@/app/sites/[id]/site-actions'
import { getAssistantTools, type AssistantToolCtx } from '../tools'
import { diffBasis } from './types'
import { layoutCanvasHandler, layoutElementsHandler, outsideCanvas, rotatedBounds, type LayoutElementsPayload } from './handlers/layout'
import { HANDLERS } from './registry'
import { CONV, OWNER, SITE, siteRow } from './test-support'

type Row = Record<string, any>
const tools = getAssistantTools()
const ctx: AssistantToolCtx = { session: { user: { id: OWNER } }, accountId: OWNER, siteId: SITE, locale: 'en', conversationId: CONV, emit: vi.fn() }
const hctx = { siteId: SITE, accountId: OWNER }

let table: Row[] = []
let seats: Row[] = []
let site: Row = {}
let nextId = 1
const el = (id: string, over: Row = {}): Row => ({ id, siteId: SITE, type: 'bar', shape: 'rect', x: 5, y: 5, width: 4, height: 2, rotation: 0, label: 'Bar', color: null, z: 100, cornerRadius: 0, ...over })

async function call(name: string, input: Record<string, unknown>) {
  const ex = await executeToolCall(tools, { id: 't1', name, arguments: JSON.stringify(input) }, ctx)
  return (ex.result ?? { ok: false, errors: ex.errors }) as Record<string, any>
}
const storedPayload = () => (vi.mocked(createProposal).mock.calls.at(-1)![0].payload as any).data as LayoutElementsPayload

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(auth).mockResolvedValue({ user: { id: OWNER } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as never)
  vi.mocked(createProposal).mockResolvedValue({ id: 'act-1' } as never)
  site = siteRow({ layoutMode: 'schematic', layoutWidth: 50, layoutHeight: 35 })
  table = [el('cl0000aaaaaa'), el('cl0000bbbbbb', { type: 'sand', shape: 'rect', x: 0, y: 0, width: 20, height: 10, label: null })]
  seats = []
  nextId = 1
  vi.mocked(prisma.site.findUnique).mockImplementation((async (a: any) => (a.where.id === SITE ? site : null)) as never)
  vi.mocked(prisma.layoutElement.findMany).mockImplementation((async (a: any) => {
    const w = a.where ?? {}
    return table.filter((r) => r.siteId === w.siteId && (!w.id?.in || w.id.in.includes(r.id))).map((r) => ({ ...r }))
  }) as never)
  vi.mocked(prisma.inventoryItem.findMany).mockImplementation((async () => seats) as never)
  vi.mocked(schematic.createLayoutElement).mockImplementation((async (siteId: string, d: Row) => {
    const row = el(`cl${String(nextId++).padStart(4, '0')}new${nextId}`, { ...d, siteId })
    table.push(row)
    return { status: 'ok', element: row }
  }) as never)
  vi.mocked(schematic.updateLayoutElement).mockImplementation((async (id: string, patch: Row) => {
    const r = table.find((x) => x.id === id)
    if (!r) return { status: 'error', errors: ['Not found'] }
    Object.assign(r, patch)
    return { status: 'ok' }
  }) as never)
  vi.mocked(schematic.deleteLayoutElement).mockImplementation((async (id: string) => {
    table = table.filter((x) => x.id !== id)
    return { status: 'ok' }
  }) as never)
  vi.mocked(siteActions.saveLayoutDimensions).mockResolvedValue({ status: 'ok' } as never)
})

describe('registration', () => {
  it('both kinds are in the handler registry and both tools are registered', () => {
    expect(HANDLERS.layout_elements).toBe(layoutElementsHandler)
    expect(HANDLERS.layout_canvas).toBe(layoutCanvasHandler)
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['propose_layout_elements', 'propose_canvas_size']))
  })
})

describe('propose_layout_elements: scoping and validation', () => {
  it('refuses geo (Google Maps) sites with an explanation and stores nothing', async () => {
    site = siteRow({ layoutMode: 'geo' })
    const res = await call('propose_layout_elements', { add: [{ type: 'pool', x: 1, y: 1 }] })
    expect(res.ok).toBe(false)
    expect(JSON.stringify(res)).toMatch(/Google Maps layout, not the schematic/)
    expect(createProposal).not.toHaveBeenCalled()
    expect(JSON.stringify(await call('propose_canvas_size', { width_m: 60, height_m: 40 }))).toMatch(/not the schematic/)
  })

  it('resolves handles inside the site only: a handle of another site element, an unknown handle and a cuid are all refused', async () => {
    table.push(el('cl0000cccccc', { siteId: 'site-other' }))
    for (const element of ['cccccc', 'zzzzzz', 'cl0000aaaaaa-nope']) {
      const res = await call('propose_layout_elements', { update: [{ element, x: 1 }] })
      expect(res.ok, element).toBe(false)
    }
    expect(createProposal).not.toHaveBeenCalled()
  })

  it('an ambiguous handle is refused, and a delete cannot be mixed with other changes', async () => {
    table.push(el('cl0001aaaaaa'))
    expect(JSON.stringify(await call('propose_layout_elements', { update: [{ element: 'aaaaaa', x: 1 }] }))).toMatch(/ambiguous/)
    expect(JSON.stringify(await call('propose_layout_elements', { delete: [{ element: 'bbbbbb' }], add: [{ type: 'pool', x: 1, y: 1 }] }))).toMatch(/on its own/)
  })

  it('stores ids (never handles) resolved in-site, fills preset defaults, and rejects an unknown type / bad numbers', async () => {
    const res = await call('propose_layout_elements', { add: [{ type: 'pool', x: 10, y: 4 }], update: [{ element: 'aaaaaa', x: 9 }] })
    expect(res).toMatchObject({ ok: true, status: 'proposed' })
    const p = storedPayload()
    expect(p.add![0]).toMatchObject({ type: 'pool', shape: 'ellipse', width: 12, height: 6, rotation: 0 })
    expect(p.update![0]).toEqual({ id: 'cl0000aaaaaa', patch: { x: 9 } })
    expect((await call('propose_layout_elements', { add: [{ type: 'volcano', x: 1, y: 1 }] })).ok).toBe(false)
    expect((await call('propose_layout_elements', { add: [{ type: 'bar', x: 1, y: 1, w: -3 }] })).ok).toBe(false)
    expect((await call('propose_layout_elements', { update: [{ element: 'aaaaaa' }] })).ok).toBe(false)
  })
})

describe('diff, preview and warnings', () => {
  it('warns when an added or moved element would leave the canvas (rotation counted), not when inside', async () => {
    const res = await call('propose_layout_elements', { add: [{ type: 'water', x: 40, y: 5 }, { type: 'bar', x: 1, y: 1 }], update: [{ element: 'aaaaaa', y: 34 }] })
    expect(res.warnings).toHaveLength(2)
    expect(res.warnings.join(' ')).toMatch(/water/)
    expect(res.warnings.join(' ')).toMatch(/bar/i)
    expect(outsideCanvas({ x: 0, y: 0, width: 50, height: 10, rotation: 0 }, { width: 50, height: 35 })).toBe(false)
    expect(outsideCanvas({ x: 0, y: 12, width: 50, height: 10, rotation: 90 }, { width: 50, height: 35 })).toBe(true) // rotated 50 m side is 50 tall
    const b = rotatedBounds({ x: 0, y: 0, width: 4, height: 2, rotation: 90 })
    expect([b.minX, b.maxX, b.minY, b.maxY].map((n) => Math.round(n * 1e6) / 1e6)).toEqual([1, 3, -1, 3])
  })

  it('geometry.elements carries added / moved(before, after) / removed and matches the diff', async () => {
    const diff = await layoutElementsHandler.diff(hctx, { add: [{ type: 'pool', shape: 'ellipse', x: 10, y: 4, width: 12, height: 6, rotation: 0, label: null, color: null }], update: [{ id: 'cl0000aaaaaa', patch: { x: 9, rotation: 90 } }] })
    expect(diff.geometry).toMatchObject({ mode: 'schematic', elements: { added: [{ type: 'pool', x: 10, y: 4, w: 12, h: 6 }], moved: [{ id: 'cl0000aaaaaa', before: { x: 5, rotation: 0 }, after: { x: 9, y: 5, w: 4, h: 2, rotation: 90 } }], removed: [] } })
    expect(diff.changes.map((c) => c.field)).toEqual(['x', 'rotation'])
    expect(diff.creates).toHaveLength(1)
    const del = await layoutElementsHandler.diff(hctx, { del: [{ id: 'cl0000bbbbbb' }] })
    expect(del.deletes).toHaveLength(1)
    expect(del.geometry!.elements!.removed).toEqual([{ id: 'cl0000bbbbbb', label: 'sand' }])
  })

  it('a foreign element id in a stored payload is refused at diff and at execute (id-only actions are not trusted)', async () => {
    table.push(el('cl0000cccccc', { siteId: 'site-other' }))
    await expect(layoutElementsHandler.diff(hctx, { update: [{ id: 'cl0000cccccc', patch: { x: 1 } }] })).rejects.toThrow(/no longer exists/)
    await expect(layoutElementsHandler.execute(hctx, { del: [{ id: 'cl0000cccccc' }] }, [])).rejects.toThrow(/no longer exists/)
    expect(schematic.deleteLayoutElement).not.toHaveBeenCalled()
  })

  it('the review basis changes when an element moved since the proposal (stale)', async () => {
    const payload: LayoutElementsPayload = { update: [{ id: 'cl0000aaaaaa', patch: { x: 9 } }] }
    const shown = await layoutElementsHandler.diff(hctx, payload)
    table[0]!.x = 6
    expect(diffBasis(await layoutElementsHandler.diff(hctx, payload))).not.toBe(diffBasis(shown))
  })
})

describe('apply / undo through the real action signatures', () => {
  const payload: LayoutElementsPayload = {
    add: [{ type: 'pool', shape: 'ellipse', x: 10, y: 4, width: 12, height: 6, rotation: 0, label: 'Pool', color: null }],
    update: [{ id: 'cl0000aaaaaa', patch: { x: 9, label: null } }],
  }

  it('execute calls create/update with exactly the previewed values; undo restores the update and deletes the created element', async () => {
    const before = JSON.parse(JSON.stringify(table))
    const snap = await layoutElementsHandler.snapshot(hctx, payload)
    const done: string[] = []
    await layoutElementsHandler.execute(hctx, payload, done)
    expect(done).toEqual(['add:0', 'update:0'])
    expect(schematic.createLayoutElement).toHaveBeenCalledWith(SITE, payload.add![0])
    expect(schematic.updateLayoutElement).toHaveBeenCalledWith('cl0000aaaaaa', { x: 9, label: null })
    expect(table).toHaveLength(3)
    expect((await layoutElementsHandler.diff(hctx, payload, { applied: true })).changes).toEqual([])

    await layoutElementsHandler.restore(hctx, payload, snap)
    expect(table).toEqual(before)
  })

  it('undo is stale once someone changed what the proposal wrote', async () => {
    await layoutElementsHandler.execute(hctx, payload, [])
    table.find((r) => r.id === 'cl0000aaaaaa')!.x = 20
    expect((await layoutElementsHandler.diff(hctx, payload, { applied: true })).changes).toHaveLength(1)
  })

  it('a failed step reports the action error with the finished steps; rollback (only) undoes just those', async () => {
    vi.mocked(schematic.updateLayoutElement).mockResolvedValueOnce({ status: 'error', errors: ['Invalid x'] } as never)
    const snap = await layoutElementsHandler.snapshot(hctx, payload)
    const done: string[] = []
    await expect(layoutElementsHandler.execute(hctx, payload, done)).rejects.toThrow('Invalid x')
    expect(done).toEqual(['add:0'])
    await layoutElementsHandler.restore(hctx, payload, snap, done)
    expect(table).toHaveLength(2)
    expect(table.find((r) => r.id === 'cl0000aaaaaa')!.x).toBe(5)
  })

  it('a delete runs through deleteLayoutElement and is not restorable', async () => {
    const snap = await layoutElementsHandler.snapshot(hctx, { del: [{ id: 'cl0000bbbbbb' }] })
    await layoutElementsHandler.execute(hctx, { del: [{ id: 'cl0000bbbbbb' }] }, [])
    expect(table.map((r) => r.id)).toEqual(['cl0000aaaaaa'])
    await layoutElementsHandler.restore(hctx, { del: [{ id: 'cl0000bbbbbb' }] }, snap)
    expect(table.map((r) => r.id)).toEqual(['cl0000aaaaaa'])
  })
})

describe('propose_canvas_size', () => {
  it('diffs the size, warns about elements and sunbeds outside the new canvas, and applies via saveLayoutDimensions', async () => {
    seats = [{ schematicX: 45, schematicY: 5 }, { schematicX: 3, schematicY: 3 }]
    const res = await call('propose_canvas_size', { width_m: 18, height_m: 35 })
    expect(res).toMatchObject({ ok: true })
    expect(res.changes).toEqual([expect.objectContaining({ field: 'width', before: 50, after: 18 })])
    expect(res.warnings.join(' ')).toMatch(/1 sunbed/)
    expect(res.warnings.join(' ')).toMatch(/1 layout element/) // the 20 m sand no longer fits; the bar does
  })

  it('execute / restore go through saveLayoutDimensions; restoring an unset size falls back to the editor default', async () => {
    await layoutCanvasHandler.execute(hctx, { width: 60, height: 40 }, [])
    expect(siteActions.saveLayoutDimensions).toHaveBeenCalledWith(SITE, 60, 40)
    await layoutCanvasHandler.restore(hctx, { width: 60, height: 40 }, { width: null, height: null })
    expect(siteActions.saveLayoutDimensions).toHaveBeenLastCalledWith(SITE, 50, 35)
    expect((await call('propose_canvas_size', { width_m: 600, height_m: 40 }))?.ok).toBe(false)
  })
})
