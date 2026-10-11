/**
 * Assistant INVENTORY actions end to end against sunbnb_test (track 030 S4a; act-immediately since
 * 2026-10-11): the propose_* tool stores the map preview and applies it in the same call through the
 * REAL parcel actions, and the database must end up exactly where the preview said (preview ==
 * result); `undoAssistantAction` restores the snapshot. Deletes are the exception: the tool leaves
 * them pending, nothing is written until the typed-confirm `applyAssistantAction`. A stale pending
 * proposal is created directly (`planInventory` + `createProposalFor`) to keep exercising the
 * lifecycle's stale check, which still guards that Apply.
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
import { syncChairsWithLayout } from '@/app/sites/[id]/inventory/actions'
import type { ChairConfig } from '@/app/sites/[id]/inventory/chair-util'
import { createProposalFor } from '@/lib/assistant/proposals/create'
import { inventoryHandler, planInventory } from '@/lib/assistant/proposals/handlers/inventory'
import { applyAssistantAction, undoAssistantAction } from './actions'

const tools = getAssistantTools()
let ownerId: string
let siteId: string
let conversationId: string

const ctx = (): AssistantToolCtx => ({ session: { user: { id: ownerId } }, accountId: ownerId, siteId, locale: 'en', conversationId })

async function propose(name: string, input: Record<string, unknown>) {
  const ex = await executeToolCall(tools, { id: 't1', name, arguments: JSON.stringify(input) }, ctx())
  const res = ex.result as { ok?: boolean; actionId?: string; error?: string; errors?: string[]; warnings?: string[] }
  expect(ex.errors, JSON.stringify(ex)).toEqual([])
  expect(res.ok, JSON.stringify(res)).toBe(true)
  return res
}
/** A write tool must WRITE in the same call and say so. */
async function act(name: string, input: Record<string, unknown>) {
  const res = (await propose(name, input)) as Awaited<ReturnType<typeof propose>> & { status?: string }
  expect(res.status, JSON.stringify(res)).toBe('applied')
  expect((await prisma.assistantAction.findUniqueOrThrow({ where: { id: res.actionId } })).status).toBe('applied')
  return res
}
const previewOf = async (actionId: string) =>
  (await prisma.assistantAction.findUniqueOrThrow({ where: { id: actionId } })).preview as any

const BASE = { lat: 36.7213, lng: -4.4214 }
const config = (over: Partial<ChairConfig> = {}): ChairConfig => ({
  group: 1, rows: 2, seatsPerRow: 4, baseLat: BASE.lat, baseLng: BASE.lng,
  horizontalGap: 1, verticalGap: 1.5, intraPairGap: 0.4, rotation: 0, pairSeats: true, category: 'PRICE1', price: 9, ...over,
})
const seedParcel = (over: Partial<ChairConfig> = {}) => syncChairsWithLayout(siteId, config(over), 'create')

const seatRows = () =>
  prisma.inventoryItem.findMany({ where: { siteId }, orderBy: { number: 'asc' } })
const units = () => prisma.sunbedGroup.count({ where: { siteId } })

beforeAll(async () => { await cleanDatabase() })
afterAll(async () => { await cleanDatabase(); await disconnectDatabase() })
beforeEach(async () => {
  await cleanDatabase()
  const owner = await createTestUser()
  ownerId = owner.id
  await createTestPartnerAccount(ownerId)
  siteId = (await createTestSite(ownerId, { price: 10 })).id
  conversationId = (await createConversation({ accountId: ownerId, siteId })).id
  mockUserId = ownerId
})

describe('create parcel: act immediately -> undo', () => {
  it('the database ends up exactly where the previewed ghost seats were; undo removes the parcel completely', async () => {
    const res = await act('propose_create_parcel', { anchor: { lat: 36.8, lng: -4.5 }, rows: 2, seats_per_row: 4, rotation: 15 })
    const actionId = res.actionId!
    const geometry = (await previewOf(actionId)).geometry
    expect(geometry.added).toHaveLength(8)

    // Written by the tool call itself -- there is no separate apply step.
    const rows = await seatRows()
    expect(rows).toHaveLength(8)
    const preview = geometry.added.map((a: any) => [a.at.lat, a.at.lng, a.at.rotation]).sort()
    const actual = rows.map((r) => [parseFloat(r.locationLat), parseFloat(r.locationLng), r.rotation]).sort()
    expect(actual).toEqual(preview)
    expect(rows.every((r) => r.group === 1 && r.seatLabel && r.sunbedGroupId)).toBe(true)
    expect(await units()).toBe(4)
    expect(await prisma.itemGroup.count()).toBe(1)

    expect(await undoAssistantAction(actionId)).toMatchObject({ status: 'ok' })
    expect(await prisma.inventoryItem.count({ where: { siteId } })).toBe(0)
    expect(await units()).toBe(0)
    expect(await prisma.itemGroup.count()).toBe(0)
  })

  it('undo is refused (in_use) once a reservation includes the created sunbeds', async () => {
    const { actionId } = await act('propose_create_parcel', { anchor: { lat: 36.8, lng: -4.5 }, rows: 1, seats_per_row: 2 })
    const seat = (await seatRows())[0]!
    await prisma.reservation.create({
      data: {
        siteId, userId: ownerId, status: 'paid-in-cash', from: new Date(), to: new Date(Date.now() + 86_400_000),
        items: { connect: { id: seat.id } },
      } as never,
    })
    const res = await undoAssistantAction(actionId!)
    expect(res.status).toBe('error')
    expect((res as { errors: string[] }).errors[0]).toBe('in_use')
    expect(await prisma.inventoryItem.count({ where: { siteId } })).toBe(2)
  })
})

describe('rotate parcel: act immediately -> undo', () => {
  it('preview == result for every seat; undo restores positions, rotation, ItemGroup and labels exactly', async () => {
    await seedParcel({ rotation: 30 })
    const before = await seatRows()
    const igBefore = await prisma.itemGroup.findFirstOrThrow()
    const { actionId } = await act('propose_rotate', { target: { parcel: 1 }, degrees: 90 })
    const geometry = (await previewOf(actionId!)).geometry
    expect(geometry.moved).toHaveLength(8)
    expect((await seatRows()).map((r) => r.locationLat)).not.toEqual(before.map((r) => r.locationLat)) // already moved

    const after = await seatRows()
    const byId = new Map(after.map((r) => [r.id, r]))
    for (const m of geometry.moved) {
      const r = byId.get(m.id)!
      expect(parseFloat(r.locationLat)).toBeCloseTo(m.after.lat, 10)
      expect(parseFloat(r.locationLng)).toBeCloseTo(m.after.lng, 10)
      expect(r.rotation).toBe(m.after.rotation)
    }
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id)) // same seats, same units
    expect((await prisma.itemGroup.findFirstOrThrow()).rotation).toBe(120)

    expect(await undoAssistantAction(actionId!)).toMatchObject({ status: 'ok' })
    const restored = await seatRows()
    expect(restored.map((r) => [r.id, r.locationLat, r.locationLng, r.rotation, r.number, r.seatLabel, r.sunbedGroupId, r.status]))
      .toEqual(before.map((r) => [r.id, r.locationLat, r.locationLng, r.rotation, r.number, r.seatLabel, r.sunbedGroupId, r.status]))
    const igAfter = await prisma.itemGroup.findFirstOrThrow()
    expect([igAfter.rotation, igAfter.locationLat, igAfter.locationLng]).toEqual([igBefore.rotation, igBefore.locationLat, igBefore.locationLng])
  })

  it('an UNPAIRED parcel stays unpaired through rotate AND through undo (pairing is read from the units)', async () => {
    await seedParcel({ pairSeats: false, intraPairGap: 0.4 })
    const unitsBefore = await units()
    expect(unitsBefore).toBe(8) // every seat its own unit
    const { actionId } = await act('propose_rotate', { target: { parcel: 1 }, degrees: 45 })
    expect(await units()).toBe(8)
    const members = await prisma.inventoryItem.groupBy({ by: ['sunbedGroupId'], where: { siteId }, _count: { _all: true } })
    expect(members.every((m) => m._count._all === 1)).toBe(true)
    await undoAssistantAction(actionId!)
    expect(await units()).toBe(8)
  })

  it('STALE undo: a seat moved after apply is never clobbered', async () => {
    await seedParcel()
    const { actionId } = await act('propose_rotate', { target: { parcel: 1 }, degrees: 90 })
    const seat = (await seatRows())[0]!
    await prisma.inventoryItem.update({ where: { id: seat.id }, data: { locationLat: '10.5' } })
    expect(await undoAssistantAction(actionId!)).toEqual({ status: 'error', errors: ['stale'] })
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: seat.id } })).locationLat).toBe('10.5')
  })

  it('STALE apply (a pending proposal): a seat moved after it was stored makes the card stale; nothing is written', async () => {
    await seedParcel()
    const planned = await planInventory(siteId, [{ op: 'rotate', target: { parcel: 1 }, degrees: 90 }])
    if ('errors' in planned) throw new Error(planned.errors.join('; '))
    const made = await createProposalFor(ctx(), inventoryHandler, planned.payload)
    if (!made.ok) throw new Error(made.error)
    const actionId = made.card.actionId
    const seat = (await seatRows())[0]!
    await prisma.inventoryItem.update({ where: { id: seat.id }, data: { rotation: 77 } })
    expect(await applyAssistantAction(actionId)).toEqual({ status: 'error', errors: ['stale'] })
    expect((await prisma.itemGroup.findFirstOrThrow()).rotation).toBe(0)
  })
})

describe('move / status / reverse / delete', () => {
  it('move parcel by metres: preview == result, undo restores; the ItemGroup anchor moves with the seats', async () => {
    await seedParcel()
    const before = await seatRows()
    const { actionId } = await act('propose_move', { target: { parcel: 1 }, by_m: { dx: 4, dy: -3 } })
    const geometry = (await previewOf(actionId!)).geometry
    const byId = new Map((await seatRows()).map((r) => [r.id, r]))
    for (const m of geometry.moved) {
      expect(parseFloat(byId.get(m.id)!.locationLat)).toBeCloseTo(m.after.lat, 9)
      expect(parseFloat(byId.get(m.id)!.locationLng)).toBeCloseTo(m.after.lng, 9)
    }
    const ig = await prisma.itemGroup.findFirstOrThrow()
    expect(parseFloat(ig.locationLat)).toBeCloseTo(BASE.lat - 3 / 111320, 9)
    await undoAssistantAction(actionId!)
    expect((await seatRows()).map((r) => r.locationLat)).toEqual(before.map((r) => r.locationLat))
    expect((await prisma.itemGroup.findFirstOrThrow()).locationLat).toBe(String(BASE.lat))
  })

  it('disable a unit via its seat id, then undo', async () => {
    await seedParcel()
    const { actionId } = await act('propose_set_status', { target: { seats: ['1-1-1'] }, status: 'disabled' })
    expect((await seatRows()).filter((r) => r.status === 'disabled')).toHaveLength(2)
    await undoAssistantAction(actionId!)
    expect((await seatRows()).every((r) => r.status === 'active')).toBe(true)
  })

  it('reverse numbering: the QR warning count is exact, labels change, undo restores them', async () => {
    await seedParcel()
    const before = await seatRows()
    const res = await act('propose_reverse', { parcel: 1, what: 'numbering' })
    expect(res.warnings).toContain('QR cards for 8 seats need reprinting')
    const after = await seatRows()
    expect(after.map((r) => r.seatLabel)).not.toEqual(before.map((r) => r.seatLabel))
    expect(after.filter((r) => r.seatLabel !== before.find((b) => b.id === r.id)!.seatLabel).length).toBeGreaterThan(0)
    await undoAssistantAction(res.actionId!)
    const restored = await seatRows()
    expect(restored.map((r) => [r.id, r.number, r.seatLabel])).toEqual(before.map((r) => [r.id, r.number, r.seatLabel]))
  })

  it('delete stays PENDING: the tool writes nothing; the typed-confirm Apply deletes for real and it is NOT undoable', async () => {
    await seedParcel()
    const res = await propose('propose_delete', { target: { parcel: 1 } })
    expect(res).toMatchObject({ status: 'proposed' })
    const actionId = res.actionId!
    expect((await previewOf(actionId)).geometry.removed).toHaveLength(8)
    expect((await prisma.assistantAction.findUniqueOrThrow({ where: { id: actionId } })).status).toBe('proposed')
    expect(await prisma.inventoryItem.count({ where: { siteId } })).toBe(8) // nothing written yet
    expect(await units()).toBe(4)

    expect(await applyAssistantAction(actionId)).toMatchObject({ status: 'ok' })
    expect(await prisma.inventoryItem.count({ where: { siteId } })).toBe(0)
    expect(await undoAssistantAction(actionId)).toMatchObject({ status: 'error', errors: ['not_undoable', expect.any(String)] })
  })

  it('shrinking a parcel removes seats, so it stays PENDING (nothing written) until Apply; its undo is then refused (the removed beds cannot come back)', async () => {
    await seedParcel()
    const res = await propose('propose_edit_parcel', { parcel: 1, seats_per_row: 2 })
    expect(res).toMatchObject({ status: 'proposed' })
    expect(await prisma.inventoryItem.count({ where: { siteId } })).toBe(8)
    expect(await applyAssistantAction(res.actionId!)).toMatchObject({ status: 'ok' })
    expect(await prisma.inventoryItem.count({ where: { siteId } })).toBe(4)
    const undo = await undoAssistantAction(res.actionId!)
    expect(undo).toMatchObject({ status: 'error', errors: ['in_use', expect.stringMatching(/removed by this change/)] })
  })

  it('growing a parcel adds seats; undo deletes exactly those and restores the ItemGroup shape', async () => {
    await seedParcel()
    const before = await seatRows()
    const { actionId } = await act('propose_edit_parcel', { parcel: 1, seats_per_row: 6 })
    expect(await prisma.inventoryItem.count({ where: { siteId } })).toBe(12)
    expect(await undoAssistantAction(actionId!)).toMatchObject({ status: 'ok' })
    const restored = await seatRows()
    expect(restored.map((r) => [r.id, r.locationLat, r.locationLng, r.number])).toEqual(before.map((r) => [r.id, r.locationLat, r.locationLng, r.number]))
    expect((await prisma.itemGroup.findFirstOrThrow()).seatsPerRow).toBe(4)
    expect(await units()).toBe(4)
  })
})
