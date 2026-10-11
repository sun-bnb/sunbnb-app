/**
 * Assistant LAYOUT proposals end to end against sunbnb_test (track 030 S4c): propose -> apply (REAL
 * create/update/delete actions) -> the database equals the previewed ghosts -> undo.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import { createTestUser, createTestPartnerAccount, createTestSite } from '@/app/test/fixtures'

let mockUserId: string | null = null

vi.mock('@/app/auth', () => ({
  auth: vi.fn(async () => (mockUserId ? { user: { id: mockUserId } } : null)),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@vercel/blob', () => ({ put: vi.fn() }))
vi.mock('sharp', () => ({ default: vi.fn() }))

import { executeToolCall } from '@repo/agent/loop'
import { createConversation } from '@repo/data/assistant'
import { getAssistantTools, type AssistantToolCtx } from '@/lib/assistant/tools'
import { elementHandle } from '@/lib/assistant/tools/helpers'
import { applyAssistantAction, undoAssistantAction } from './actions'

const tools = getAssistantTools()
let ownerId: string
let siteId: string
let conversationId: string

const ctx = (): AssistantToolCtx => ({ session: { user: { id: ownerId } }, accountId: ownerId, siteId, locale: 'en', conversationId })
async function propose(name: string, input: Record<string, unknown>) {
  const ex = await executeToolCall(tools, { id: 't1', name, arguments: JSON.stringify(input) }, ctx())
  const res = ex.result as { ok?: boolean; actionId?: string }
  expect(ex.errors, JSON.stringify(ex)).toEqual([])
  expect(res.ok, JSON.stringify(res)).toBe(true)
  return res.actionId!
}
const previewOf = async (id: string) => (await prisma.assistantAction.findUniqueOrThrow({ where: { id } })).preview as any
const elements = () => prisma.layoutElement.findMany({ where: { siteId }, orderBy: { createdAt: 'asc' } })

beforeAll(async () => { await cleanDatabase() })
afterAll(async () => { await cleanDatabase(); await disconnectDatabase() })
beforeEach(async () => {
  await cleanDatabase()
  ownerId = (await createTestUser()).id
  await createTestPartnerAccount(ownerId)
  siteId = (await createTestSite(ownerId, { price: 10 })).id
  await prisma.site.update({ where: { id: siteId }, data: { layoutMode: 'schematic', layoutWidth: 50, layoutHeight: 35 } })
  conversationId = (await createConversation({ accountId: ownerId, siteId })).id
  mockUserId = ownerId
})

describe('layout elements: propose -> apply -> undo', () => {
  it('adds an element exactly where the ghost was drawn, and undo deletes it', async () => {
    const id = await propose('propose_layout_elements', { add: [{ type: 'pool', x: 10, y: 4, label: 'Pool' }] })
    const ghost = (await previewOf(id)).geometry.elements.added[0]
    expect(await elements()).toHaveLength(0)

    expect(await applyAssistantAction(id)).toMatchObject({ status: 'ok' })
    const rows = await elements()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'pool', shape: 'ellipse', x: ghost.x, y: ghost.y, width: ghost.w, height: ghost.h, rotation: ghost.rotation, label: 'Pool' })

    expect(await undoAssistantAction(id)).toMatchObject({ status: 'ok' })
    expect(await elements()).toHaveLength(0)
  })

  it('moves an element by handle and undo puts it back; undo is refused after a later edit', async () => {
    const el = await prisma.layoutElement.create({ data: { siteId, type: 'bar', shape: 'rect', x: 5, y: 5, width: 4, height: 2, label: 'Bar' } })
    const id = await propose('propose_layout_elements', { update: [{ element: elementHandle(el.id), x: 12, rotation: 90, label: 'Beach bar' }] })
    const moved = (await previewOf(id)).geometry.elements.moved[0]
    expect(moved).toMatchObject({ id: el.id, before: { x: 5, rotation: 0 }, after: { x: 12, y: 5, rotation: 90 } })

    expect(await applyAssistantAction(id)).toMatchObject({ status: 'ok' })
    expect(await prisma.layoutElement.findUniqueOrThrow({ where: { id: el.id } })).toMatchObject({ x: 12, rotation: 90, label: 'Beach bar' })
    expect(await undoAssistantAction(id)).toMatchObject({ status: 'ok' })
    expect(await prisma.layoutElement.findUniqueOrThrow({ where: { id: el.id } })).toMatchObject({ x: 5, y: 5, rotation: 0, label: 'Bar' })
  })

  it('apply is stale when the element moved after the proposal; delete is permanent and not undoable', async () => {
    const el = await prisma.layoutElement.create({ data: { siteId, type: 'bar', shape: 'rect', x: 5, y: 5, width: 4, height: 2 } })
    const stale = await propose('propose_layout_elements', { update: [{ element: elementHandle(el.id), x: 12 }] })
    await prisma.layoutElement.update({ where: { id: el.id }, data: { x: 7 } })
    expect(await applyAssistantAction(stale)).toMatchObject({ status: 'error', errors: ['stale'] })

    const del = await propose('propose_layout_elements', { delete: [{ element: elementHandle(el.id) }] })
    expect(await applyAssistantAction(del)).toMatchObject({ status: 'ok' })
    expect(await elements()).toHaveLength(0)
    expect(await undoAssistantAction(del)).toMatchObject({ status: 'error' })
    expect(await elements()).toHaveLength(0)
  })

  it('never touches another site: its element handle does not resolve', async () => {
    const other = await createTestSite(ownerId, { price: 10 })
    const foreign = await prisma.layoutElement.create({ data: { siteId: other.id, type: 'bar', shape: 'rect', x: 1, y: 1, width: 2, height: 2 } })
    const ex = await executeToolCall(tools, { id: 't', name: 'propose_layout_elements', arguments: JSON.stringify({ delete: [{ element: elementHandle(foreign.id) }] }) }, ctx())
    expect((ex.result as any).ok).toBe(false)
    expect(await prisma.layoutElement.count({ where: { id: foreign.id } })).toBe(1)
  })
})

describe('canvas size: propose -> apply -> undo', () => {
  it('resizes via saveLayoutDimensions and restores the previous size', async () => {
    const id = await propose('propose_canvas_size', { width_m: 80, height_m: 40 })
    expect(await applyAssistantAction(id)).toMatchObject({ status: 'ok' })
    expect(await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).toMatchObject({ layoutWidth: 80, layoutHeight: 40 })
    expect(await undoAssistantAction(id)).toMatchObject({ status: 'ok' })
    expect(await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).toMatchObject({ layoutWidth: 50, layoutHeight: 35 })
  })
})
