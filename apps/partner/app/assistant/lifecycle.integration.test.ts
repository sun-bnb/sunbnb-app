/**
 * Assistant proposals end to end against the real sunbnb_test DB (track 030 S3): the propose tool
 * stores a proposal, `applyAssistantAction` runs the REAL existing actions, `undoAssistantAction`
 * restores from the snapshot. Only auth / next/cache / blob+sharp are mocked.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from '@/app/test/setup'
import { createTestUser, createTestPartnerAccount, createTestSite, createTestProduct } from '@/app/test/fixtures'

let mockUserId: string | null = null

vi.mock('@/app/auth', () => ({
  auth: vi.fn(async () => (mockUserId ? { user: { id: mockUserId } } : null)),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@vercel/blob', () => ({ put: vi.fn() }))
vi.mock('sharp', () => ({ default: vi.fn() }))

import { executeToolCall } from '@repo/agent/loop'
import { createConversation, getProposalForAccount } from '@repo/data/assistant'
import { getAssistantTools, type AssistantToolCtx } from '@/lib/assistant/tools'
import { applyAssistantAction, rejectAssistantAction, undoAssistantAction } from './actions'

const tools = getAssistantTools()

let ownerId: string
let siteId: string
let conversationId: string

function ctx(): AssistantToolCtx {
  return { session: { user: { id: ownerId } }, accountId: ownerId, siteId, locale: 'en', conversationId }
}

async function propose(name: string, input: Record<string, unknown>): Promise<string> {
  const ex = await executeToolCall(tools, { id: 't1', name, arguments: JSON.stringify(input) }, ctx())
  const res = ex.result as { ok?: boolean; actionId?: string; error?: string }
  expect(ex.errors, JSON.stringify(ex)).toEqual([])
  expect(res.ok, JSON.stringify(res)).toBe(true)
  return res.actionId!
}

async function notes(): Promise<string[]> {
  const c = await prisma.assistantConversation.findUniqueOrThrow({ where: { id: conversationId } })
  return (c.messages as { content: string; note?: boolean }[]).filter((m) => m.note).map((m) => m.content)
}

beforeAll(async () => {
  await cleanDatabase()
})
afterAll(async () => {
  await cleanDatabase()
  await disconnectDatabase()
})

beforeEach(async () => {
  await cleanDatabase()
  const owner = await createTestUser()
  ownerId = owner.id
  await createTestPartnerAccount(ownerId)
  const site = await createTestSite(ownerId, { price: 10, vat: 21, name: 'Playa', description: 'Old text', services: ['wc'] })
  siteId = site.id
  conversationId = (await createConversation({ accountId: ownerId, siteId })).id
  mockUserId = ownerId
})

describe('site fields: propose -> apply -> undo', () => {
  it('a proposal changes nothing; apply writes through saveGeneral / saveContentFields; undo restores', async () => {
    const actionId = await propose('propose_site_fields', { price: 12, name: 'Playa Azul', description: 'New text', services: ['wc', 'food'] })

    // Proposing never writes.
    let site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } })
    expect([site.price, site.name, site.description]).toEqual([10, 'Playa', 'Old text'])
    const proposed = await prisma.assistantAction.findUniqueOrThrow({ where: { id: actionId } })
    expect(proposed.status).toBe('proposed')
    expect(proposed.expiresAt.getTime()).toBeGreaterThan(Date.now())

    const applied = await applyAssistantAction(actionId)
    expect(applied.status).toBe('ok')
    site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } })
    expect([site.price, site.name, site.description, site.services]).toEqual([12, 'Playa Azul', 'New text', ['wc', 'food']])
    expect(site.vat).toBe(21) // untouched by the merge
    const row = await prisma.assistantAction.findUniqueOrThrow({ where: { id: actionId } })
    expect(row.status).toBe('applied')
    expect(row.snapshot).toMatchObject({ name: 'Playa', price: 10, description: 'Old text', services: ['wc'] })

    // The same card cannot be applied twice.
    expect(await applyAssistantAction(actionId)).toMatchObject({ status: 'error', errors: ['already_resolved'] })

    const undone = await undoAssistantAction(actionId)
    expect(undone.status).toBe('ok')
    site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } })
    expect([site.price, site.name, site.description, site.services]).toEqual([10, 'Playa', 'Old text', ['wc']])
    expect((await prisma.assistantAction.findUniqueOrThrow({ where: { id: actionId } })).status).toBe('undone')

    const log = await notes()
    expect(log).toHaveLength(2)
    expect(log[0]).toMatch(/^\[applied\] Changed site/)
    expect(log[1]).toMatch(/^\[undone\]/)
  })

  it('STALE apply: a price edited after the proposal is never overwritten by the old proposal', async () => {
    const actionId = await propose('propose_site_fields', { price: 12 })
    await prisma.site.update({ where: { id: siteId }, data: { price: 15 } })
    expect(await applyAssistantAction(actionId)).toEqual({ status: 'error', errors: ['stale'] })
    expect((await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).price).toBe(15)
    expect((await prisma.assistantAction.findUniqueOrThrow({ where: { id: actionId } })).status).toBe('failed')
  })

  it('STALE undo: a later edit survives; the undo is refused', async () => {
    const actionId = await propose('propose_site_fields', { price: 12 })
    await applyAssistantAction(actionId)
    await prisma.site.update({ where: { id: siteId }, data: { price: 99 } })
    expect(await undoAssistantAction(actionId)).toEqual({ status: 'error', errors: ['stale'] })
    expect((await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).price).toBe(99)
    expect((await prisma.assistantAction.findUniqueOrThrow({ where: { id: actionId } })).status).toBe('applied')
  })

  it('undo outside the 24 h window is refused', async () => {
    const actionId = await propose('propose_site_fields', { price: 12 })
    await applyAssistantAction(actionId)
    await prisma.assistantAction.update({ where: { id: actionId }, data: { appliedAt: new Date(Date.now() - 25 * 3_600_000) } })
    expect(await undoAssistantAction(actionId)).toEqual({ status: 'error', errors: ['undo_window'] })
    expect((await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).price).toBe(12)
  })

  it('an expired proposal cannot be applied', async () => {
    const actionId = await propose('propose_site_fields', { price: 12 })
    await prisma.assistantAction.update({ where: { id: actionId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect(await applyAssistantAction(actionId)).toEqual({ status: 'error', errors: ['expired'] })
    expect((await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).price).toBe(10)
  })

  it('reject leaves the data alone and cannot be followed by apply', async () => {
    const actionId = await propose('propose_site_fields', { price: 12 })
    expect((await rejectAssistantAction(actionId)).status).toBe('ok')
    expect(await applyAssistantAction(actionId)).toEqual({ status: 'error', errors: ['already_resolved'] })
    expect((await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).price).toBe(10)
  })

  it('another account cannot apply, reject or undo it; the lookup is account-scoped', async () => {
    const actionId = await propose('propose_site_fields', { price: 12 })
    const intruder = await createTestUser()
    mockUserId = intruder.id
    for (const fn of [applyAssistantAction, rejectAssistantAction, undoAssistantAction]) {
      expect(await fn(actionId)).toEqual({ status: 'error', errors: ['not_found'] })
    }
    expect(await getProposalForAccount(actionId, intruder.id)).toBeNull()
    expect((await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).price).toBe(10)
    expect((await prisma.assistantAction.findUniqueOrThrow({ where: { id: actionId } })).status).toBe('proposed')
  })

  it('a sudo (not the owner) can apply, and the change lands on the owner\'s site', async () => {
    const actionId = await propose('propose_site_fields', { price: 12 })
    const admin = await createTestUser({ sudo: true })
    mockUserId = admin.id
    expect((await applyAssistantAction(actionId)).status).toBe('ok')
    expect((await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).price).toBe(12)
    expect((await undoAssistantAction(actionId)).status).toBe('ok')
    expect((await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).price).toBe(10)
  })
})

describe('products: propose -> apply -> undo', () => {
  it('creates and updates (net price derived by addProduct/updateProduct), then undo removes the created and restores the updated', async () => {
    await createTestProduct(siteId, { name: 'Mojito', price: 7.27, tax: 10, totalPrice: 8, category: 'drink' })
    const actionId = await propose('propose_products', {
      upsert: [{ name: 'mojito', price: 9.9, soldOut: true }, { name: 'Paella', price: 15, vat: 10, category: 'food', description: 'Rice' }],
    })
    expect(await prisma.product.count({ where: { siteId } })).toBe(1) // the proposal wrote nothing

    expect((await applyAssistantAction(actionId)).status).toBe('ok')
    const mojito = await prisma.product.findFirstOrThrow({ where: { siteId, name: 'Mojito' } })
    expect([mojito.totalPrice, mojito.tax, mojito.soldOut]).toEqual([9.9, 10, true])
    expect(mojito.price).toBe(9) // 9.9 / 1.10, from computeVatAndBaseAmounts -- not computed in the assistant
    const paella = await prisma.product.findFirstOrThrow({ where: { siteId, name: 'Paella' } })
    expect([paella.totalPrice, paella.tax, paella.category, paella.description, paella.active]).toEqual([15, 10, 'food', 'Rice', true])

    expect((await undoAssistantAction(actionId)).status).toBe('ok')
    const restored = await prisma.product.findFirstOrThrow({ where: { siteId, name: 'Mojito' } })
    expect([restored.totalPrice, restored.tax, restored.soldOut, restored.price]).toEqual([8, 10, false, 7.27])
    const removed = await prisma.product.findFirstOrThrow({ where: { siteId, name: 'Paella' } })
    expect(removed.active).toBe(false)
    expect(await prisma.product.count({ where: { siteId, active: true } })).toBe(1)
  })

  it('undo is refused once the created product has orders', async () => {
    const actionId = await propose('propose_products', { upsert: [{ name: 'Paella', price: 15, vat: 10 }] })
    await applyAssistantAction(actionId)
    const paella = await prisma.product.findFirstOrThrow({ where: { siteId, name: 'Paella' } })
    const order = await prisma.order.create({ data: { price: 1, tax: 0, totalPrice: 1, siteId, userId: ownerId } })
    await prisma.orderItem.create({ data: { orderId: order.id, productId: paella.id, quantity: 1, name: 'Paella', price: 1, tax: 10, totalPrice: 1 } })
    expect(await undoAssistantAction(actionId)).toMatchObject({ status: 'error', errors: ['in_use', expect.any(String)] })
    expect((await prisma.product.findUniqueOrThrow({ where: { id: paella.id } })).active).toBe(true)
  })

  it('delete is a soft delete and is NOT undone; the other changes in the same proposal are', async () => {
    await createTestProduct(siteId, { name: 'Old', totalPrice: 3, price: 2.73, tax: 10 })
    await createTestProduct(siteId, { name: 'Mojito', price: 7.27, tax: 10, totalPrice: 8 })
    const actionId = await propose('propose_products', { upsert: [{ name: 'Mojito', price: 9 }], delete: ['Old'] })
    await applyAssistantAction(actionId)
    expect((await prisma.product.findFirstOrThrow({ where: { siteId, name: 'Old' } })).active).toBe(false)
    const undone = await undoAssistantAction(actionId)
    expect(undone).toMatchObject({ status: 'ok', summary: expect.stringContaining('removed items are not restored') })
    expect((await prisma.product.findFirstOrThrow({ where: { siteId, name: 'Old' } })).active).toBe(false)
    expect((await prisma.product.findFirstOrThrow({ where: { siteId, name: 'Mojito' } })).totalPrice).toBe(8)
  })

  it('STALE: a product renamed/removed after the proposal -> the apply is refused', async () => {
    const actionId = await propose('propose_products', { upsert: [{ name: 'Paella', price: 15, vat: 10 }] })
    await createTestProduct(siteId, { name: 'Paella', totalPrice: 14, price: 12.7, tax: 10 }) // appeared since
    expect(await applyAssistantAction(actionId)).toEqual({ status: 'error', errors: ['stale'] })
    expect(await prisma.product.count({ where: { siteId } })).toBe(1)
  })
})

describe('hours, brand and account fields', () => {
  it('working hours: apply replaces the day\'s ranges through the existing actions; undo restores them', async () => {
    await prisma.siteWorkingHours.create({ data: { siteId, day: 1, openTime: new Date('2000-01-01T09:00:00Z'), closeTime: new Date('2000-01-01T13:00:00Z') } })
    await prisma.siteWorkingHours.create({ data: { siteId, day: 1, openTime: new Date('2000-01-01T15:00:00Z'), closeTime: new Date('2000-01-01T19:00:00Z') } })
    const actionId = await propose('propose_working_hours', { week: [{ day: 'Mon', open: '08:00', close: '20:00' }, { day: 'Sun', open: '10:00', close: '14:00' }] })
    expect((await applyAssistantAction(actionId)).status).toBe('ok')
    const show = async () => (await prisma.siteWorkingHours.findMany({ where: { siteId }, orderBy: [{ day: 'asc' }, { openTime: 'asc' }] }))
      .map((r) => `${r.day} ${r.openTime.toISOString().slice(11, 16)}-${r.closeTime.toISOString().slice(11, 16)}`)
    expect(await show()).toEqual(['1 08:00-20:00', '7 10:00-14:00'])
    expect((await undoAssistantAction(actionId)).status).toBe('ok')
    expect(await show()).toEqual(['1 09:00-13:00', '1 15:00-19:00'])
  })

  it('brand: creates the brand row (colours keep their defaults) and undo removes it again', async () => {
    const actionId = await propose('propose_brand', { brandName: 'Playa Azul', tagline: 'Sun and sea' })
    expect(await applyAssistantAction(actionId)).toMatchObject({ status: 'ok' })
    expect(await prisma.siteBrand.findUnique({ where: { siteId } })).toMatchObject({ brandName: 'Playa Azul', tagline: 'Sun and sea' })
    expect((await undoAssistantAction(actionId)).status).toBe('ok')
    expect(await prisma.siteBrand.findUnique({ where: { siteId } })).toBeNull()
  })

  it('slug: apply + undo, and a slug taken by another site is refused at proposal time', async () => {
    const other = await createTestSite(ownerId, { slug: 'taken-slug' })
    expect(other.slug).toBe('taken-slug')
    const refused = await executeToolCall(tools, { id: 't', name: 'propose_slug', arguments: JSON.stringify({ slug: 'taken-slug' }) }, ctx())
    expect((refused.result as { ok: boolean }).ok).toBe(false)
    const actionId = await propose('propose_slug', { slug: 'playa-azul' })
    expect((await applyAssistantAction(actionId)).status).toBe('ok')
    expect((await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).slug).toBe('playa-azul')
    expect((await undoAssistantAction(actionId)).status).toBe('ok')
    expect((await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).slug).toBeNull()
  })

  it('account fields: patches only the named columns of the OWNER\'s account (a sudo applying does not touch their own), re-records the tax id, undo restores', async () => {
    await prisma.partnerAccount.update({ where: { userId: ownerId }, data: { city: 'Malaga', country: 'ES', businessId: 'B12345674', bankAccount: 'ES9121000418450200051332' } })
    const admin = await createTestUser({ sudo: true })
    await createTestPartnerAccount(admin.id, { city: 'Admin City' })
    const actionId = await propose('propose_account_fields', { city: 'Marbella', businessId: 'es b-12345674' })
    mockUserId = admin.id
    expect(await applyAssistantAction(actionId)).toMatchObject({ status: 'ok' })

    const owner = await prisma.partnerAccount.findUniqueOrThrow({ where: { userId: ownerId } })
    expect([owner.city, owner.businessId, owner.bankAccount, owner.company]).toEqual(['Marbella', 'ESB12345674', 'ES9121000418450200051332', 'Test Company Oy'])
    expect(owner.vatIdCheckedAt).not.toBeNull()
    expect((await prisma.partnerAccount.findUniqueOrThrow({ where: { userId: admin.id } })).city).toBe('Admin City')

    expect((await undoAssistantAction(actionId)).status).toBe('ok')
    const back = await prisma.partnerAccount.findUniqueOrThrow({ where: { userId: ownerId } })
    expect([back.city, back.businessId, back.bankAccount]).toEqual(['Malaga', 'B12345674', 'ES9121000418450200051332'])
  })
})
