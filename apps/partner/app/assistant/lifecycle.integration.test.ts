/**
 * Assistant actions end to end against the real sunbnb_test DB (track 030 S3, act-immediately since
 * 2026-10-11): a write TOOL stores the action and applies it in the same call (`createAndApply`);
 * `undoAssistantAction` restores from the snapshot. The lifecycle itself (pending -> apply, stale,
 * expiry, reject, account scoping, sudo) is still what backs pending deletes and the card's Apply
 * button, so those tests create a PENDING proposal directly (`pend`, via `createProposalFor`) and
 * drive `applyAssistantAction` / `rejectAssistantAction`. Only auth / next/cache / blob+sharp are mocked.
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
import { createProposalFor } from '@/lib/assistant/proposals/create'
import { MAX_ACTIONS_PER_TURN } from '@/lib/assistant/proposals/act'
import { siteFieldsHandler, planSiteFields } from '@/lib/assistant/proposals/handlers/site-fields'
import { productsHandler, planProducts } from '@/lib/assistant/proposals/handlers/products'
import { accountHandler, planAccountFields } from '@/lib/assistant/proposals/handlers/account'
import type { KindHandler } from '@/lib/assistant/proposals/types'
import { applyAssistantAction, rejectAssistantAction, undoAssistantAction } from './actions'

const tools = getAssistantTools()

let ownerId: string
let siteId: string
let conversationId: string

function ctx(): AssistantToolCtx {
  return { session: { user: { id: ownerId } }, accountId: ownerId, siteId, locale: 'en', conversationId }
}

/** Call a write tool: it must WRITE immediately and report `status: 'applied'`. Returns the action id. */
async function act(name: string, input: Record<string, unknown>, c: AssistantToolCtx = ctx()): Promise<string> {
  const ex = await executeToolCall(tools, { id: 't1', name, arguments: JSON.stringify(input) }, c)
  const res = ex.result as { ok?: boolean; actionId?: string; status?: string; error?: string }
  expect(ex.errors, JSON.stringify(ex)).toEqual([])
  expect(res.ok, JSON.stringify(res)).toBe(true)
  expect(res.status, JSON.stringify(res)).toBe('applied')
  return res.actionId!
}

/** Store a PENDING proposal without applying it (the lifecycle path that still backs deletes and the Apply button). */
async function pend<P>(handler: KindHandler<P, unknown>, planned: { payload: P } | { errors: string[] }): Promise<string> {
  if ('errors' in planned) throw new Error(planned.errors.join('; '))
  const out = await createProposalFor(ctx(), handler, planned.payload)
  if (!out.ok) throw new Error(out.error)
  return out.card.actionId
}
const status = async (id: string) => (await prisma.assistantAction.findUniqueOrThrow({ where: { id } })).status

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

describe('site fields: act immediately -> undo', () => {
  it('the tool call writes through saveGeneral / saveContentFields at once; undo restores exactly', async () => {
    const actionId = await act('propose_site_fields', { price: 12, name: 'Playa Azul', description: 'New text', services: ['wc', 'food'] })

    // Written already -- no Apply click.
    let site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } })
    expect([site.price, site.name, site.description, site.services]).toEqual([12, 'Playa Azul', 'New text', ['wc', 'food']])
    expect(site.vat).toBe(21) // untouched by the merge
    const row = await prisma.assistantAction.findUniqueOrThrow({ where: { id: actionId } })
    expect(row.status).toBe('applied')
    expect(row.appliedAt).not.toBeNull()
    expect(row.snapshot).toMatchObject({ name: 'Playa', price: 10, description: 'Old text', services: ['wc'] })

    // The same card cannot be applied twice.
    expect(await applyAssistantAction(actionId)).toMatchObject({ status: 'error', errors: ['already_resolved'] })

    expect((await undoAssistantAction(actionId)).status).toBe('ok')
    site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } })
    expect([site.price, site.name, site.description, site.services]).toEqual([10, 'Playa', 'Old text', ['wc']])
    expect((await prisma.assistantAction.findUniqueOrThrow({ where: { id: actionId } })).status).toBe('undone')

    // The tool result already told the model; only the undo (a user click) leaves a transcript note.
    const log = await notes()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatch(/^\[undone\]/)
  })

  it('a pending proposal changes nothing; Apply writes through saveGeneral / saveContentFields and leaves an [applied] note; undo restores', async () => {
    const actionId = await pend(siteFieldsHandler, planSiteFields({ price: 12, name: 'Playa Azul', description: 'New text', services: ['wc', 'food'] }))

    let site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } })
    expect([site.price, site.name, site.description]).toEqual([10, 'Playa', 'Old text'])
    const proposed = await prisma.assistantAction.findUniqueOrThrow({ where: { id: actionId } })
    expect(proposed.status).toBe('proposed')
    expect(proposed.expiresAt.getTime()).toBeGreaterThan(Date.now())

    expect((await applyAssistantAction(actionId)).status).toBe('ok')
    site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } })
    expect([site.price, site.name, site.description, site.services]).toEqual([12, 'Playa Azul', 'New text', ['wc', 'food']])
    expect(await status(actionId)).toBe('applied')
    expect((await undoAssistantAction(actionId)).status).toBe('ok')
    site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } })
    expect([site.price, site.name, site.description, site.services]).toEqual([10, 'Playa', 'Old text', ['wc']])

    const log = await notes()
    expect(log).toHaveLength(2)
    expect(log[0]).toMatch(/^\[applied\] Changed site/)
    expect(log[1]).toMatch(/^\[undone\]/)
  })

  it('a no-op tool call (values already match) writes nothing and creates no action', async () => {
    const ex = await executeToolCall(tools, { id: 't', name: 'propose_site_fields', arguments: JSON.stringify({ price: 10 }) }, ctx())
    expect((ex.result as { ok: boolean }).ok).toBe(false)
    expect(await prisma.assistantAction.count()).toBe(0)
  })

  it('per-turn cap: the sixth write in one turn is refused and nothing is written', async () => {
    const turn = ctx() // one ctx == one turn; `applied` counts on it
    for (let i = 1; i <= MAX_ACTIONS_PER_TURN; i++) await act('propose_site_fields', { price: 10 + i }, turn)
    const ex = await executeToolCall(tools, { id: 't', name: 'propose_site_fields', arguments: JSON.stringify({ price: 99 }) }, turn)
    expect((ex.result as { ok: boolean; error?: string }).ok).toBe(false)
    expect((ex.result as { error?: string }).error).toMatch(/Action limit reached/)
    expect((await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).price).toBe(10 + MAX_ACTIONS_PER_TURN)
    expect(await prisma.assistantAction.count({ where: { status: 'applied' } })).toBe(MAX_ACTIONS_PER_TURN)
  })

  it('STALE apply: a price edited after the proposal is never overwritten by the old proposal', async () => {
    const actionId = await pend(siteFieldsHandler, planSiteFields({ price: 12 }))
    await prisma.site.update({ where: { id: siteId }, data: { price: 15 } })
    expect(await applyAssistantAction(actionId)).toEqual({ status: 'error', errors: ['stale'] })
    expect((await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).price).toBe(15)
    expect(await status(actionId)).toBe('failed')
  })

  it('STALE undo: a later edit survives; the undo is refused', async () => {
    const actionId = await act('propose_site_fields', { price: 12 })
    await prisma.site.update({ where: { id: siteId }, data: { price: 99 } })
    expect(await undoAssistantAction(actionId)).toEqual({ status: 'error', errors: ['stale'] })
    expect((await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).price).toBe(99)
    expect(await status(actionId)).toBe('applied')
  })

  it('undo outside the 24 h window is refused', async () => {
    const actionId = await act('propose_site_fields', { price: 12 })
    await prisma.assistantAction.update({ where: { id: actionId }, data: { appliedAt: new Date(Date.now() - 25 * 3_600_000) } })
    expect(await undoAssistantAction(actionId)).toEqual({ status: 'error', errors: ['undo_window'] })
    expect((await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).price).toBe(12)
  })

  it('an expired pending proposal cannot be applied', async () => {
    const actionId = await pend(siteFieldsHandler, planSiteFields({ price: 12 }))
    await prisma.assistantAction.update({ where: { id: actionId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect(await applyAssistantAction(actionId)).toEqual({ status: 'error', errors: ['expired'] })
    expect((await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).price).toBe(10)
  })

  it('reject leaves the data alone and cannot be followed by apply', async () => {
    const actionId = await pend(siteFieldsHandler, planSiteFields({ price: 12 }))
    expect((await rejectAssistantAction(actionId)).status).toBe('ok')
    expect(await applyAssistantAction(actionId)).toEqual({ status: 'error', errors: ['already_resolved'] })
    expect((await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).price).toBe(10)
  })

  it('an applied action cannot be rejected', async () => {
    const actionId = await act('propose_site_fields', { price: 12 })
    expect(await rejectAssistantAction(actionId)).toEqual({ status: 'error', errors: ['already_resolved'] })
    expect((await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).price).toBe(12)
  })

  it('another account cannot apply, reject or undo it; the lookup is account-scoped', async () => {
    const actionId = await pend(siteFieldsHandler, planSiteFields({ price: 12 }))
    const intruder = await createTestUser()
    mockUserId = intruder.id
    for (const fn of [applyAssistantAction, rejectAssistantAction, undoAssistantAction]) {
      expect(await fn(actionId)).toEqual({ status: 'error', errors: ['not_found'] })
    }
    expect(await getProposalForAccount(actionId, intruder.id)).toBeNull()
    expect((await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).price).toBe(10)
    expect(await status(actionId)).toBe('proposed')
  })

  it('another account cannot undo an already-applied action', async () => {
    const actionId = await act('propose_site_fields', { price: 12 })
    mockUserId = (await createTestUser()).id
    expect(await undoAssistantAction(actionId)).toEqual({ status: 'error', errors: ['not_found'] })
    expect((await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).price).toBe(12)
  })

  it('a sudo (not the owner) can apply a pending proposal, and the change lands on the owner\'s site', async () => {
    const actionId = await pend(siteFieldsHandler, planSiteFields({ price: 12 }))
    const admin = await createTestUser({ sudo: true })
    mockUserId = admin.id
    expect((await applyAssistantAction(actionId)).status).toBe('ok')
    expect((await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).price).toBe(12)
    expect((await undoAssistantAction(actionId)).status).toBe('ok')
    expect((await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).price).toBe(10)
  })
})

describe('products: act immediately -> undo', () => {
  it('creates and updates (net price derived by addProduct/updateProduct), then undo removes the created and restores the updated', async () => {
    await createTestProduct(siteId, { name: 'Mojito', price: 7.27, tax: 10, totalPrice: 8, category: 'drink' })
    const actionId = await act('propose_products', {
      upsert: [{ name: 'mojito', price: 9.9, soldOut: true }, { name: 'Paella', price: 15, vat: 10, category: 'food', description: 'Rice' }],
    })
    expect(await prisma.product.count({ where: { siteId } })).toBe(2) // written by the tool call itself
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
    const actionId = await act('propose_products', { upsert: [{ name: 'Paella', price: 15, vat: 10 }] })
    const paella = await prisma.product.findFirstOrThrow({ where: { siteId, name: 'Paella' } })
    const order = await prisma.order.create({ data: { price: 1, tax: 0, totalPrice: 1, siteId, userId: ownerId } })
    await prisma.orderItem.create({ data: { orderId: order.id, productId: paella.id, quantity: 1, name: 'Paella', price: 1, tax: 10, totalPrice: 1 } })
    expect(await undoAssistantAction(actionId)).toMatchObject({ status: 'error', errors: ['in_use', expect.any(String)] })
    expect((await prisma.product.findUniqueOrThrow({ where: { id: paella.id } })).active).toBe(true)
  })

  it('a proposal that deletes stays PENDING: the tool writes nothing (not even its upserts) until Apply; the soft delete is then NOT undone, the other changes are', async () => {
    await createTestProduct(siteId, { name: 'Old', totalPrice: 3, price: 2.73, tax: 10 })
    await createTestProduct(siteId, { name: 'Mojito', price: 7.27, tax: 10, totalPrice: 8 })
    const ex = await executeToolCall(tools, { id: 't', name: 'propose_products', arguments: JSON.stringify({ upsert: [{ name: 'Mojito', price: 9 }], delete: ['Old'] }) }, ctx())
    const res = ex.result as { ok: boolean; status: string; actionId: string; instruction: string }
    expect(res).toMatchObject({ ok: true, status: 'proposed' })
    expect(res.instruction).toMatch(/NOT applied/)
    const actionId = res.actionId
    expect(await status(actionId)).toBe('proposed')
    expect((await prisma.product.findFirstOrThrow({ where: { siteId, name: 'Old' } })).active).toBe(true)
    expect((await prisma.product.findFirstOrThrow({ where: { siteId, name: 'Mojito' } })).totalPrice).toBe(8)
    // Undoing something never applied is refused.
    expect(await undoAssistantAction(actionId)).toMatchObject({ status: 'error', errors: ['already_resolved'] })

    expect((await applyAssistantAction(actionId)).status).toBe('ok') // the typed-confirm Apply of the card
    expect((await prisma.product.findFirstOrThrow({ where: { siteId, name: 'Old' } })).active).toBe(false)
    expect((await prisma.product.findFirstOrThrow({ where: { siteId, name: 'Mojito' } })).totalPrice).toBe(9)
    const undone = await undoAssistantAction(actionId)
    expect(undone).toMatchObject({ status: 'ok', summary: expect.stringContaining('removed items are not restored') })
    expect((await prisma.product.findFirstOrThrow({ where: { siteId, name: 'Old' } })).active).toBe(false)
    expect((await prisma.product.findFirstOrThrow({ where: { siteId, name: 'Mojito' } })).totalPrice).toBe(8)
  })

  it('STALE: a product renamed/removed after the proposal -> the apply is refused', async () => {
    const actionId = await pend(productsHandler, planProducts({ upsert: [{ name: 'Paella', price: 15, vat: 10 }] }))
    await createTestProduct(siteId, { name: 'Paella', totalPrice: 14, price: 12.7, tax: 10 }) // appeared since
    expect(await applyAssistantAction(actionId)).toEqual({ status: 'error', errors: ['stale'] })
    expect(await prisma.product.count({ where: { siteId } })).toBe(1)
  })
})

describe('hours, brand and account fields', () => {
  it('working hours: the tool call replaces the day\'s ranges through the existing actions; undo restores them', async () => {
    await prisma.siteWorkingHours.create({ data: { siteId, day: 1, openTime: new Date('2000-01-01T09:00:00Z'), closeTime: new Date('2000-01-01T13:00:00Z') } })
    await prisma.siteWorkingHours.create({ data: { siteId, day: 1, openTime: new Date('2000-01-01T15:00:00Z'), closeTime: new Date('2000-01-01T19:00:00Z') } })
    const actionId = await act('propose_working_hours', { week: [{ day: 'Mon', open: '08:00', close: '20:00' }, { day: 'Sun', open: '10:00', close: '14:00' }] })
    const show = async () => (await prisma.siteWorkingHours.findMany({ where: { siteId }, orderBy: [{ day: 'asc' }, { openTime: 'asc' }] }))
      .map((r) => `${r.day} ${r.openTime.toISOString().slice(11, 16)}-${r.closeTime.toISOString().slice(11, 16)}`)
    expect(await show()).toEqual(['1 08:00-20:00', '7 10:00-14:00'])
    expect((await undoAssistantAction(actionId)).status).toBe('ok')
    expect(await show()).toEqual(['1 09:00-13:00', '1 15:00-19:00'])
  })

  it('brand: creates the brand row (colours keep their defaults) and undo removes it again', async () => {
    const actionId = await act('propose_brand', { brandName: 'Playa Azul', tagline: 'Sun and sea' })
    expect(await prisma.siteBrand.findUnique({ where: { siteId } })).toMatchObject({ brandName: 'Playa Azul', tagline: 'Sun and sea' })
    expect((await undoAssistantAction(actionId)).status).toBe('ok')
    expect(await prisma.siteBrand.findUnique({ where: { siteId } })).toBeNull()
  })

  it('slug: applied at once + undo, and a slug taken by another site is refused at proposal time', async () => {
    const other = await createTestSite(ownerId, { slug: 'taken-slug' })
    expect(other.slug).toBe('taken-slug')
    const refused = await executeToolCall(tools, { id: 't', name: 'propose_slug', arguments: JSON.stringify({ slug: 'taken-slug' }) }, ctx())
    expect((refused.result as { ok: boolean }).ok).toBe(false)
    const actionId = await act('propose_slug', { slug: 'playa-azul' })
    expect((await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).slug).toBe('playa-azul')
    expect((await undoAssistantAction(actionId)).status).toBe('ok')
    expect((await prisma.site.findUniqueOrThrow({ where: { id: siteId } })).slug).toBeNull()
  })

  it('account fields: patches only the named columns of the OWNER\'s account (a sudo applying does not touch their own), re-records the tax id, undo restores', async () => {
    await prisma.partnerAccount.update({ where: { userId: ownerId }, data: { city: 'Malaga', country: 'ES', businessId: 'B12345674', bankAccount: 'ES9121000418450200051332' } })
    const admin = await createTestUser({ sudo: true })
    await createTestPartnerAccount(admin.id, { city: 'Admin City' })
    const actionId = await pend(accountHandler, planAccountFields({ city: 'Marbella', businessId: 'es b-12345674' }))
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
