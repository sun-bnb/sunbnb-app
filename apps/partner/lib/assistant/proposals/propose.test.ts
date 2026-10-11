/**
 * The assistant's write tools are PROPOSAL-ONLY (track 030 S3): each builds a correct before -> after
 * from the CURRENT database values, stores it, emits the `proposal` event -- and never writes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@repo/data/assistant', () => ({ createProposal: vi.fn() }))
// Applying is the lifecycle's job (covered in lifecycle.test.ts); here the tool's PLANNING is under test.
vi.mock('./lifecycle', () => ({ applyProposal: vi.fn() }))
vi.mock('@/app/sites/[id]/site-actions', () => ({
  saveGeneral: vi.fn(), setSiteStatus: vi.fn(), setPartialGroupBooking: vi.fn(), saveBrand: vi.fn(), saveSlug: vi.fn(),
  checkSlug: vi.fn(),
}))
vi.mock('@/app/sites/[id]/content-actions', () => ({ saveContentFields: vi.fn() }))
vi.mock('@/app/sites/[id]/working-hours-actions', () => ({ addWorkingHours: vi.fn(), updateWorkingHours: vi.fn(), deleteWorkingHours: vi.fn() }))
vi.mock('@/app/sites/[id]/products/actions', () => ({ addProduct: vi.fn(), updateProduct: vi.fn(), toggleProductSoldOut: vi.fn(), deleteProduct: vi.fn() }))
vi.mock('@/app/sites/[id]/rentals/actions', () => ({ createRentalItem: vi.fn(), updateRentalItem: vi.fn(), deleteRentalItem: vi.fn() }))
vi.mock('@/lib/account-fields', async (orig) => ({ ...(await orig<typeof import('@/lib/account-fields')>()), applyAccountPatch: vi.fn(), restoreAccountFields: vi.fn() }))

import { executeToolCall } from '@repo/agent/loop'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { createProposal } from '@repo/data/assistant'
import { applyProposal } from './lifecycle'
import * as siteActions from '@/app/sites/[id]/site-actions'
import * as contentActions from '@/app/sites/[id]/content-actions'
import * as hoursActions from '@/app/sites/[id]/working-hours-actions'
import * as productActions from '@/app/sites/[id]/products/actions'
import * as rentalActions from '@/app/sites/[id]/rentals/actions'
import * as accountFields from '@/lib/account-fields'
import { getAssistantTools, type AssistantToolCtx } from '../tools'
import { CONV, OWNER, SITE, siteRow } from './test-support'

const tools = getAssistantTools()
const emit = vi.fn()
const ctx: AssistantToolCtx = { session: { user: { id: OWNER } }, accountId: OWNER, siteId: SITE, locale: 'en', conversationId: CONV, emit }

async function propose(name: string, input: Record<string, unknown>, c: AssistantToolCtx = ctx) {
  return executeToolCall(tools, { id: 't1', name, arguments: JSON.stringify(input) }, c)
}
type Result = Record<string, any>
async function ok(name: string, input: Record<string, unknown>): Promise<Result> {
  const ex = await propose(name, input)
  expect(ex.errors).toEqual([])
  expect((ex.result as Result).ok, JSON.stringify(ex.result)).toBe(true)
  return ex.result as Result
}
async function refused(name: string, input: Record<string, unknown>): Promise<Result> {
  vi.mocked(createProposal).mockClear()
  const ex = await propose(name, input)
  const res = ex.accepted ? (ex.result as Result) : { ok: false, errors: ex.errors }
  expect(res.ok).toBe(false)
  expect(createProposal).not.toHaveBeenCalled()
  return res
}

/** Every site-data writer the proposals ultimately use -- none may run while proposing. */
function expectNothingWritten() {
  for (const mod of [siteActions, contentActions, hoursActions, productActions, rentalActions]) {
    for (const [k, fn] of Object.entries(mod)) {
      if (k === 'checkSlug' || !vi.isMockFunction(fn)) continue
      expect(fn, k).not.toHaveBeenCalled()
    }
  }
  expect(accountFields.applyAccountPatch).not.toHaveBeenCalled()
  const p = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
  for (const model of ['site', 'product', 'rentalItem', 'siteBrand', 'siteWorkingHours', 'partnerAccount']) {
    for (const op of ['create', 'update', 'delete', 'upsert']) {
      if (p[model]?.[op]) expect(p[model][op], `${model}.${op}`).not.toHaveBeenCalled()
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(auth).mockResolvedValue({ user: { id: OWNER } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as never)
  vi.mocked(prisma.site.findUnique).mockResolvedValue(siteRow() as never)
  vi.mocked(createProposal).mockResolvedValue({ id: 'act-1' } as never)
  vi.mocked(applyProposal).mockResolvedValue({ status: 'ok', summary: 'applied' })
  ctx.applied = 0
  vi.mocked(siteActions.checkSlug).mockResolvedValue({ available: true })
  vi.mocked(prisma.product.findMany).mockResolvedValue([])
  vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([])
  vi.mocked(prisma.siteWorkingHours.findMany).mockResolvedValue([])
  vi.mocked(prisma.siteBrand.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.rentalBooking.count).mockResolvedValue(0)
})

describe('every proposal tool', () => {
  const NAMES = ['propose_site_fields', 'propose_working_hours', 'propose_brand', 'propose_slug', 'propose_products', 'propose_rental_items', 'propose_account_fields']
  const MINIMAL: Record<string, Record<string, unknown>> = {
    propose_site_fields: { price: 9.5 },
    propose_working_hours: { week: [{ day: 'Mon', open: '09:00', close: '18:00' }] },
    propose_brand: { tagline: 'New' },
    propose_slug: { slug: 'new-address' },
    propose_products: { upsert: [{ name: 'Mojito', price: 8, vat: 10 }] },
    propose_rental_items: { upsert: [{ name: 'Kayak', pricePerHour: 5, totalQuantity: 2 }] },
    propose_account_fields: { city: 'Marbella' },
  }

  it.each(NAMES)('%s stores the action and APPLIES it in the same call through the lifecycle, telling the model it was applied', async (name) => {
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({ city: 'Malaga', company: 'X', businessId: null, country: 'ES' } as never)
    vi.mocked(prisma.siteBrand.findUnique).mockResolvedValue({ brandName: 'B', tagline: null, bgColor: null, fgColor: null } as never)
    const res = await ok(name, MINIMAL[name]!)
    // The tool itself never writes site data: the single write path is applyProposal (mocked here).
    expectNothingWritten()
    expect(res).toMatchObject({ ok: true, actionId: 'act-1', status: 'applied' })
    expect(res.summary).toEqual(expect.any(String))
    expect(res.instruction).toMatch(/APPLIED/)
    expect(res.instruction).toMatch(/Undo/)
    expect(res.instruction).not.toMatch(/click Apply|never say it was applied/)
    expect(applyProposal).toHaveBeenCalledTimes(1)
    expect(applyProposal).toHaveBeenCalledWith('act-1', { note: false })
    expect(createProposal).toHaveBeenCalledTimes(1)
    expect(createProposal).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: CONV, accountId: OWNER, siteId: SITE, actorUserId: OWNER,
    }))
  })

  it.each(NAMES)('%s refuses without a session owner of the open site (no proposal stored)', async (name) => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'intruder' } } as never)
    const ex = await propose(name, MINIMAL[name]!)
    expect(ex.result).toEqual({ ok: false, error: 'forbidden' })
    expect(createProposal).not.toHaveBeenCalled()
  })

  it.each(NAMES)('%s refuses to run outside a conversation', async (name) => {
    const ex = await propose(name, MINIMAL[name]!, { ...ctx, conversationId: undefined })
    expect((ex.result as Result).ok).toBe(false)
    expect(createProposal).not.toHaveBeenCalled()
  })

  it('emits ONE `proposal` event, already status applied (+ appliedAt), only after the apply succeeded', async () => {
    let appliedBeforeEmit = false
    vi.mocked(applyProposal).mockImplementation(async () => {
      appliedBeforeEmit = emit.mock.calls.length === 0
      return { status: 'ok', summary: 'Changed site price per sunbed (incl. vat) 9 → 9.5' }
    })
    await ok('propose_site_fields', { price: 9.5 })
    expect(appliedBeforeEmit).toBe(true) // the card is never shown as pending, then flipped
    expect(emit).toHaveBeenCalledTimes(1)
    const [event, data] = emit.mock.calls[0]!
    expect(event).toBe('proposal')
    expect(data).toMatchObject({
      actionId: 'act-1',
      kind: 'site_fields',
      summary: 'Changed site price per sunbed (incl. vat) 9 → 9.5',
      status: 'applied',
      preview: { changes: [{ target: 'Site', field: 'price', label: 'Price per sunbed (incl. VAT)', before: 9, after: 9.5 }] },
    })
    expect((data as Result).appliedAt).toEqual(expect.any(Number))
  })

  it('an apply failure (stale, apply_failed ...) is returned as an error and emits NO card', async () => {
    vi.mocked(applyProposal).mockResolvedValue({ status: 'error', errors: ['apply_failed', 'boom'] })
    const ex = await propose('propose_site_fields', { price: 9.5 })
    expect(ex.result).toMatchObject({ ok: false, error: 'apply_failed: boom' })
    expect(emit).not.toHaveBeenCalled()
  })

  it('a change that DELETES stays a pending proposal: not applied, card emitted as proposed, typed confirmation instruction', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([{ id: 'p1', name: 'Mojito', totalPrice: 8, vat: 10, active: true, soldOut: false, imageUrl: null }] as never)
    const res = await ok('propose_products', { delete: ['Mojito'] })
    expect(res.status).toBe('proposed')
    expect(res.deletes).toHaveLength(1)
    expect(res.instruction).toMatch(/DELETE/)
    expect(res.instruction).toMatch(/NOT applied/)
    expect(applyProposal).not.toHaveBeenCalled()
    expect(createProposal).toHaveBeenCalledTimes(1)
    const [event, data] = emit.mock.calls[0]!
    expect(event).toBe('proposal')
    expect((data as Result).status).toBeUndefined() // no status => the client renders Apply / Reject with the typed confirm
    expect(ctx.applied).toBe(0) // a pending delete does not use the turn budget
  })

  it('at most 5 changes are applied per turn: the 6th is refused, nothing stored or applied for it', async () => {
    for (let i = 0; i < 5; i++) await ok('propose_site_fields', { price: 10 + i })
    expect(ctx.applied).toBe(5)
    vi.mocked(createProposal).mockClear()
    vi.mocked(applyProposal).mockClear()
    const ex = await propose('propose_site_fields', { price: 99 })
    expect((ex.result as Result).ok).toBe(false)
    expect((ex.result as Result).error).toMatch(/limit/i)
    expect(createProposal).not.toHaveBeenCalled()
    expect(applyProposal).not.toHaveBeenCalled()
  })

  it('expires the proposal in the future (default TTL) and stores payload + preview', async () => {
    await ok('propose_site_fields', { price: 9.5 })
    const arg = vi.mocked(createProposal).mock.calls[0]![0]
    expect(arg.ttlMs).toBeUndefined() // the data layer applies ASSISTANT_PROPOSAL_TTL_MS
    expect(arg.kind).toBe('site_fields')
    expect(arg.payload).toEqual({ v: 1, data: { fields: { price: 9.5 } } })
    expect((arg.preview as Result).changes).toHaveLength(1)
  })
})

describe('propose_site_fields', () => {
  it('builds before -> after for several fields from the CURRENT row, ignoring unchanged ones', async () => {
    const res = await ok('propose_site_fields', {
      name: 'Playa Azul', price: 9.5, vat: 10, description: 'A beach', services: ['wc', 'food'], status: 'hidden', partialGroupBooking: true,
    })
    expect(res.changes.map((c: any) => [c.field, c.before, c.after])).toEqual([
      ['price', 9, 9.5], ['vat', 21, 10], ['services', 'wc', 'wc, food'], ['status', 'active', 'hidden'], ['partialGroupBooking', false, true],
    ])
    expect(res.warnings.join(' ')).toMatch(/hidden site is not shown/)
  })

  it('price 0 means "not set": stored as null, shown as before 9 -> after null', async () => {
    const res = await ok('propose_site_fields', { price: 0 })
    expect(res.changes[0]).toMatchObject({ field: 'price', before: 9, after: null })
  })

  it('rejects when nothing would change', async () => {
    const res = await refused('propose_site_fields', { price: 9, status: 'active' })
    expect(res.error).toMatch(/Nothing would change/)
  })

  it.each([
    ['negative price', { price: -1 }],
    ['price above the action limit', { price: 100001 }],
    ['VAT above 100', { vat: 101 }],
    ['unknown status', { status: 'deleted' }],
    ['unknown service', { services: ['spa'] }],
    ['empty call', {}],
    ['smuggled siteId', { siteId: 'other', price: 5 }],
    ['smuggled location', { price: 5, locationLat: '1' }],
  ])('refuses %s with the same rules as the real action', async (_l, input) => {
    await refused('propose_site_fields', input)
  })

  it('refuses a blank name and one over 200 characters', async () => {
    await refused('propose_site_fields', { name: '   ' })
    await refused('propose_site_fields', { name: 'x'.repeat(201) })
  })

  it('needs a location before it can change name / price / VAT (saveGeneral saves them together)', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue(siteRow({ locationLat: null }) as never)
    const res = await refused('propose_site_fields', { price: 12 })
    expect(res.error).toMatch(/location/)
  })

  it('warns that the price of an off-platform site is informational', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue(siteRow({ type: 'unpaid' }) as never)
    const res = await ok('propose_site_fields', { price: 12 })
    expect(res.warnings.join(' ')).toMatch(/off-platform/)
  })
})

describe('propose_working_hours', () => {
  const row = (id: string, day: number, o: string, c: string) => ({ id, day, openTime: new Date(`2000-01-01T${o}:00.000Z`), closeTime: new Date(`2000-01-01T${c}:00.000Z`) })

  it('shows the existing ranges of each listed day as before and the new ones as after; unlisted days are untouched', async () => {
    vi.mocked(prisma.siteWorkingHours.findMany).mockResolvedValue([row('a', 1, '09:00', '13:00'), row('b', 1, '15:00', '19:00'), row('c', 2, '10:00', '18:00')] as never)
    const res = await ok('propose_working_hours', {
      week: [{ day: 'Mon', open: '08:00', close: '20:00' }, { day: 'Sun', open: '10:00', close: '14:00' }, { day: 'Tue', open: '10:00', close: '18:00' }],
    })
    expect(res.changes).toEqual([
      { target: 'Hours Mon', field: 'ranges', label: 'Opening hours', before: '09:00-13:00, 15:00-19:00', after: '08:00-20:00' },
      { target: 'Hours Sun', field: 'ranges', label: 'Opening hours', before: 'closed', after: '10:00-14:00' },
    ])
  })

  it('closed:true shows the day going from its ranges to "closed"', async () => {
    vi.mocked(prisma.siteWorkingHours.findMany).mockResolvedValue([row('a', 3, '09:00', '13:00')] as never)
    const res = await ok('propose_working_hours', { week: [{ day: 'Wed', closed: true }] })
    expect(res.changes[0]).toMatchObject({ target: 'Hours Wed', before: '09:00-13:00', after: 'closed' })
  })

  it('reads a legacy day 0 row as Sunday', async () => {
    vi.mocked(prisma.siteWorkingHours.findMany).mockResolvedValue([row('a', 0, '09:00', '13:00')] as never)
    const res = await ok('propose_working_hours', { week: [{ day: 'Sun', open: '09:00', close: '14:00' }] })
    expect(res.changes[0]).toMatchObject({ target: 'Hours Sun', before: '09:00-13:00' })
  })

  it.each([
    ['close not after open', { week: [{ day: 'Mon', open: '18:00', close: '09:00' }] }],
    ['bad time format', { week: [{ day: 'Mon', open: '9am', close: '18:00' }] }],
    ['hour 24', { week: [{ day: 'Mon', open: '09:00', close: '24:00' }] }],
    ['open and closed for the same day', { week: [{ day: 'Mon', open: '09:00', close: '10:00' }, { day: 'Mon', closed: true }] }],
    ['overlapping ranges', { week: [{ day: 'Mon', open: '09:00', close: '13:00' }, { day: 'Mon', open: '12:00', close: '18:00' }] }],
    ['unknown day', { week: [{ day: 'Funday', open: '09:00', close: '10:00' }] }],
    ['empty week', { week: [] }],
  ])('refuses %s', async (_l, input) => {
    await refused('propose_working_hours', input)
  })

  it('says so when the hours already match', async () => {
    vi.mocked(prisma.siteWorkingHours.findMany).mockResolvedValue([row('a', 1, '09:00', '18:00')] as never)
    const res = await refused('propose_working_hours', { week: [{ day: 'Mon', open: '09:00', close: '18:00' }] })
    expect(res.error).toMatch(/Nothing would change/)
  })
})

describe('propose_brand / propose_slug', () => {
  it('diffs against the brand row; unchanged fields are left out', async () => {
    vi.mocked(prisma.siteBrand.findUnique).mockResolvedValue({ brandName: 'Playa', tagline: 'Old', bgColor: '#ffffff', fgColor: '#000000' } as never)
    const res = await ok('propose_brand', { brandName: 'Playa', tagline: 'New', bgColor: '#faf9f6' })
    expect(res.changes.map((c: any) => [c.field, c.before, c.after])).toEqual([['tagline', 'Old', 'New'], ['bgColor', '#ffffff', '#faf9f6']])
  })

  it('a site without a brand needs a brand name to create one', async () => {
    const res = await refused('propose_brand', { tagline: 'Hi' })
    expect(res.error).toMatch(/brand name is required/)
  })

  it('REFUSES when a bespoke brand page is live (same rule as saveBrand)', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue(siteRow({ customBrandEnabled: true, customBrandKey: 'alcudia' }) as never)
    const res = await refused('propose_brand', { brandName: 'X' })
    expect(res.error).toMatch(/custom brand page/)
  })

  it.each([['not hex', { brandName: 'X', bgColor: 'red' }], ['long tagline', { brandName: 'X', tagline: 'x'.repeat(501) }]])('refuses %s', async (_l, input) => {
    await refused('propose_brand', input)
  })

  it('slug: normalises, checks availability, and shows old -> new with a warning', async () => {
    const res = await ok('propose_slug', { slug: '  New Address! ' })
    expect(siteActions.checkSlug).toHaveBeenCalledWith('newaddress', SITE)
    expect(res.changes[0]).toMatchObject({ field: 'slug', before: 'playa-azul', after: 'newaddress' })
    expect(res.warnings.join(' ')).toMatch(/cleaned up to "newaddress"/)
    expect(res.warnings.join(' ')).toMatch(/old address/)
  })

  it('slug: taken or too short is refused before any proposal exists', async () => {
    vi.mocked(siteActions.checkSlug).mockResolvedValue({ available: false })
    expect((await refused('propose_slug', { slug: 'taken-one' })).errors[0]).toMatch(/already taken/)
    expect((await refused('propose_slug', { slug: 'ab' })).errors[0]).toMatch(/at least 3/)
  })
})

describe('propose_products', () => {
  const product = (over: Record<string, unknown> = {}) => ({ id: 'p1', name: 'Mojito', description: null, totalPrice: 8, tax: 10, category: 'drink', soldOut: false, ...over })

  it('matches by name (case-insensitive): update shows the field diff, new product is a create with the site VAT', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([product()] as never)
    const res = await ok('propose_products', { upsert: [{ name: 'mojito', price: 8.5, soldOut: true }, { name: 'Paella', price: 15 }] })
    expect(res.changes.map((c: any) => [c.target, c.field, c.before, c.after])).toEqual([
      ['Product "Mojito"', 'price', 8, 8.5], ['Product "Mojito"', 'soldOut', false, true],
    ])
    expect(res.creates).toEqual([{ target: 'Product "Paella"', fields: { name: 'Paella', price: 15, vat: 21, category: 'food', description: null } }])
  })

  it('asks to disambiguate when two products share the name, and proposes nothing', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([product(), product({ id: 'p2', totalPrice: 9 })] as never)
    const res = await refused('propose_products', { upsert: [{ name: 'Mojito', price: 7 }] })
    expect(res.error).toMatch(/2 products named "Mojito"/)
    expect(res.error).toMatch(/Ask the user which/)
  })

  it('a new product needs a price and a VAT rate (site VAT is the fallback)', async () => {
    expect((await refused('propose_products', { upsert: [{ name: 'Paella' }] })).error).toMatch(/price .* is required/)
    vi.mocked(prisma.site.findUnique).mockResolvedValue(siteRow({ vat: null }) as never)
    expect((await refused('propose_products', { upsert: [{ name: 'Paella', price: 12 }] })).error).toMatch(/which VAT percent/)
  })

  it('delete carries the cannot-undo warning; unknown names are an error', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([product()] as never)
    const res = await ok('propose_products', { delete: ['Mojito'] })
    expect(res.deletes).toEqual([{ target: 'Product "Mojito"', label: 'Removed from the menu' }])
    expect(res.warnings.join(' ')).toMatch(/cannot be restored by undo/)
    expect((await refused('propose_products', { delete: ['Ghost'] })).error).toMatch(/No product named "Ghost"/)
  })

  it.each([
    ['price zero', { upsert: [{ name: 'A', price: 0 }] }],
    ['unknown category', { upsert: [{ name: 'A', price: 1, vat: 1, category: 'weapon' }] }],
    ['VAT above 100', { upsert: [{ name: 'A', price: 1, vat: 150 }] }],
    ['same product twice', { upsert: [{ name: 'A', price: 1, vat: 1 }, { name: 'a', price: 2, vat: 1 }] }],
    ['changed and deleted', { upsert: [{ name: 'A', price: 1, vat: 1 }], delete: ['A'] }],
    ['empty', {}],
    ['an id instead of a name', { upsert: [{ id: 'p1', price: 3 }] }],
  ])('refuses %s', async (_l, input) => {
    await refused('propose_products', input)
  })
})

describe('propose_rental_items', () => {
  const item = (over: Record<string, unknown> = {}) => ({ id: 'r1', name: 'Kayak', description: null, category: null, pricePerHour: 5, pricePerDay: 20, totalQuantity: 4, active: true, ...over })

  it('update diffs prices / quantity / active; create needs quantity and a price', async () => {
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([item()] as never)
    const res = await ok('propose_rental_items', { upsert: [{ name: 'Kayak', pricePerHour: 6, totalQuantity: 5, active: false }, { name: 'SUP', pricePerDay: 30, totalQuantity: 2 }] })
    expect(res.changes.map((c: any) => [c.field, c.before, c.after])).toEqual([['pricePerHour', 5, 6], ['totalQuantity', 4, 5], ['active', true, false]])
    expect(res.creates[0]).toMatchObject({ target: 'Rental item "SUP"', fields: { pricePerDay: 30, totalQuantity: 2 } })
    expect((await refused('propose_rental_items', { upsert: [{ name: 'Board', totalQuantity: 1 }] })).error).toMatch(/price/)
    expect((await refused('propose_rental_items', { upsert: [{ name: 'Board', pricePerDay: 3 }] })).error).toMatch(/quantity/)
  })

  it('refuses to delete an item that has bookings (the real action would refuse too)', async () => {
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([item()] as never)
    vi.mocked(prisma.rentalBooking.count).mockResolvedValue(3)
    expect((await refused('propose_rental_items', { delete: ['Kayak'] })).error).toMatch(/has bookings.*deactivat/)
  })

  it('warns when rentals are not enabled on the site', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue(siteRow({ features: [] }) as never)
    const res = await ok('propose_rental_items', { upsert: [{ name: 'SUP', pricePerDay: 30, totalQuantity: 2 }] })
    expect(res.warnings.join(' ')).toMatch(/not enabled/)
  })

  it('cannot clear the last price of an existing item', async () => {
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([item({ pricePerDay: null })] as never)
    expect((await refused('propose_rental_items', { upsert: [{ name: 'Kayak', pricePerHour: null }] })).error).toMatch(/at least one price/)
  })
})

describe('propose_account_fields', () => {
  const account = { company: 'Old SL', businessId: 'B12345674', address: 'Calle 1', city: 'Malaga', postalCode: '29000', country: 'ES', phoneNumber: '+34', email: 'a@b.es', websiteUrl: null }
  beforeEach(() => vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue(account as never))

  it('diffs the whitelisted fields against the account of the SITE OWNER', async () => {
    const res = await ok('propose_account_fields', { company: 'New SL', city: 'Malaga', websiteUrl: 'https://playa.example' })
    expect(prisma.partnerAccount.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: OWNER } }))
    expect(res.changes.map((c: any) => [c.field, c.before, c.after])).toEqual([['company', 'Old SL', 'New SL'], ['websiteUrl', null, 'https://playa.example']])
  })

  it('a tax id change shows the NORMALISED id that will be stored, plus the invoice warning', async () => {
    const res = await ok('propose_account_fields', { businessId: 'es b-12345674' })
    expect(res.changes[0]).toMatchObject({ field: 'businessId', before: 'B12345674', after: 'ESB12345674' })
    expect(res.warnings.join(' ')).toMatch(/printed on every invoice/)
  })

  it.each([
    ['bankAccount', { bankAccount: 'ES9121000418450200051332' }],
    ['iban', { iban: 'ES9121000418450200051332' }],
    ['paymentProvider', { paymentProvider: 'stripe' }],
    ['stripeConnectAccountId', { stripeConnectAccountId: 'acct_1' }],
    ['verifactu', { verifactuEnabled: true }],
    ['vatIdStatus', { vatIdStatus: 'valid' }],
    ['userId', { userId: 'someone-else' }],
    ['firstName', { firstName: 'X' }],
  ])('FORBIDDEN field %s is rejected by the schema, nothing is proposed or read', async (_l, input) => {
    const ex = await propose('propose_account_fields', { city: 'Marbella', ...input })
    expect(ex.accepted).toBe(false)
    expect(ex.errors.join(' ')).toMatch(/unknown field/)
    expect(createProposal).not.toHaveBeenCalled()
    expect(prisma.partnerAccount.findUnique).not.toHaveBeenCalled()
  })

  it.each([
    ['blanking a required field', { company: '   ' }],
    ['bad email', { email: 'nope' }],
    ['bad website URL', { websiteUrl: 'not a url' }],
    ['over-long address', { address: 'x'.repeat(301) }],
  ])('refuses %s with the account form\'s rules', async (_l, input) => {
    await refused('propose_account_fields', input)
  })

  it('no account yet -> asks the user to complete the Account page first', async () => {
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue(null)
    expect((await refused('propose_account_fields', { city: 'X' })).error).toMatch(/Account page/)
  })
})
