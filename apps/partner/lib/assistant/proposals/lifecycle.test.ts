/**
 * apply / reject / undo of assistant proposals (track 030 S3): re-authorisation, expiry, staleness,
 * single resolution, partial failure and snapshot undo. The model, the card and the stored row are
 * untrusted; the existing server actions are mocked so the tests assert exactly what they are asked
 * to write. End-to-end behaviour against Postgres: parcel-free `lifecycle.integration.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@repo/data/assistant', () => ({
  ASSISTANT_ACTION_STATUS: { PROPOSED: 'proposed', APPLIED: 'applied', REJECTED: 'rejected', UNDONE: 'undone', EXPIRED: 'expired', FAILED: 'failed' },
  ASSISTANT_UNDO_WINDOW_MS: 24 * 60 * 60 * 1000,
  getProposalForAccount: vi.fn(),
  markApplied: vi.fn(),
  markFailed: vi.fn(),
  markRejected: vi.fn(),
  markUndone: vi.fn(),
  appendMessages: vi.fn(),
  createProposal: vi.fn(),
}))
vi.mock('@/app/sites/[id]/site-actions', () => ({
  saveGeneral: vi.fn(), setSiteStatus: vi.fn(), setPartialGroupBooking: vi.fn(), saveBrand: vi.fn(), saveSlug: vi.fn(), checkSlug: vi.fn(),
}))
vi.mock('@/app/sites/[id]/content-actions', () => ({ saveContentFields: vi.fn() }))
vi.mock('@/app/sites/[id]/working-hours-actions', () => ({ addWorkingHours: vi.fn(), updateWorkingHours: vi.fn(), deleteWorkingHours: vi.fn() }))
vi.mock('@/app/sites/[id]/products/actions', () => ({ addProduct: vi.fn(), updateProduct: vi.fn(), toggleProductSoldOut: vi.fn(), deleteProduct: vi.fn() }))
vi.mock('@/app/sites/[id]/rentals/actions', () => ({ createRentalItem: vi.fn(), updateRentalItem: vi.fn(), deleteRentalItem: vi.fn() }))
vi.mock('@/lib/account-fields', async (orig) => ({ ...(await orig<typeof import('@/lib/account-fields')>()), applyAccountPatch: vi.fn(), restoreAccountFields: vi.fn() }))

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { appendMessages, getProposalForAccount, markApplied, markFailed, markRejected, markUndone } from '@repo/data/assistant'
import * as site from '@/app/sites/[id]/site-actions'
import * as content from '@/app/sites/[id]/content-actions'
import * as hours from '@/app/sites/[id]/working-hours-actions'
import * as products from '@/app/sites/[id]/products/actions'
import * as rentals from '@/app/sites/[id]/rentals/actions'
import * as accountFields from '@/lib/account-fields'
import { applyProposal, rejectProposal, undoProposal } from './lifecycle'
import { storedPreview } from './create'
import { HANDLERS } from './registry'
import { summarizeDiff } from './types'
import { CONV, OWNER, SITE, siteRow } from './test-support'
import * as snapshotCache from '../snapshot/cache'

const ACTION = 'act-1'
const HOUR = 3_600_000
const OK = { status: 'ok' as const }

/** What the fake database holds; the prisma mocks read from here. */
let state: {
  site: ReturnType<typeof siteRow>
  products: any[]
  rentals: any[]
  hours: any[]
  brand: any
  account: any
}

function wireDb() {
  vi.mocked(prisma.site.findUnique).mockImplementation((async () => state.site) as never)
  vi.mocked(prisma.product.findMany).mockImplementation((async () => state.products) as never)
  vi.mocked(prisma.rentalItem.findMany).mockImplementation((async () => state.rentals) as never)
  vi.mocked(prisma.siteWorkingHours.findMany).mockImplementation((async () => state.hours) as never)
  vi.mocked(prisma.siteBrand.findUnique).mockImplementation((async () => state.brand) as never)
  vi.mocked(prisma.partnerAccount.findUnique).mockImplementation((async () => state.account) as never)
}

type Row = Record<string, any>
let row: Row | null

/** A stored proposal whose preview is what the REAL handler computes from the current state. */
async function propose(kind: string, payload: unknown, over: Row = {}): Promise<Row> {
  const handler = HANDLERS[kind]!
  const diff = await handler.diff({ siteId: SITE, accountId: OWNER }, payload)
  return {
    id: ACTION, conversationId: CONV, accountId: OWNER, siteId: SITE, kind,
    payload: { v: 1, data: payload }, preview: storedPreview(summarizeDiff(diff), diff),
    snapshot: null, status: 'proposed', expiresAt: new Date(Date.now() + HOUR), appliedAt: null,
    ...over,
  }
}

function login(id: string, sudo = false) {
  vi.mocked(auth).mockResolvedValue({ user: { id } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo } as never)
}

const writers = () => [
  site.saveGeneral, site.setSiteStatus, site.setPartialGroupBooking, site.saveBrand, site.saveSlug, content.saveContentFields,
  hours.addWorkingHours, hours.updateWorkingHours, hours.deleteWorkingHours,
  products.addProduct, products.updateProduct, products.toggleProductSoldOut, products.deleteProduct,
  rentals.createRentalItem, rentals.updateRentalItem, rentals.deleteRentalItem, accountFields.applyAccountPatch,
]
function expectNoWrites() {
  for (const w of writers()) expect(w).not.toHaveBeenCalled()
  expect(markApplied).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  state = { site: siteRow(), products: [], rentals: [], hours: [], brand: null, account: null }
  wireDb()
  row = null
  login(OWNER)
  vi.mocked(getProposalForAccount).mockImplementation((async (id: string, accountId: string) =>
    row && row.id === id && row.accountId === accountId ? row : null) as never)
  vi.mocked(prisma.assistantAction.findUnique).mockResolvedValue(null)
  vi.mocked(markApplied).mockResolvedValue(true)
  vi.mocked(markFailed).mockResolvedValue(true)
  vi.mocked(markRejected).mockResolvedValue(true)
  vi.mocked(markUndone).mockResolvedValue(true)
  vi.mocked(appendMessages).mockResolvedValue({} as never)
  for (const w of writers()) vi.mocked(w as never as () => unknown).mockResolvedValue(OK as never)
  vi.mocked(accountFields.applyAccountPatch).mockResolvedValue({ status: 'ok', snapshot: { values: {} } })
  vi.mocked(prisma.orderItem.count).mockResolvedValue(0)
  vi.mocked(prisma.rentalBooking.count).mockResolvedValue(0)
})

describe('authorisation (every entry point re-authorises)', () => {
  const entries = [['apply', applyProposal], ['reject', rejectProposal], ['undo', undoProposal]] as const

  it.each(entries)('%s: no session -> Not authenticated, nothing read or written', async (_n, fn) => {
    vi.mocked(auth).mockResolvedValue(null)
    expect(await fn(ACTION)).toEqual({ status: 'error', errors: ['Not authenticated'] })
    expect(getProposalForAccount).not.toHaveBeenCalled()
    expectNoWrites()
  })

  it.each(entries)('%s: a malformed id is not_found without touching the database', async (_n, fn) => {
    expect(await fn('../etc')).toEqual({ status: 'error', errors: ['not_found'] })
    expect(await fn(undefined)).toEqual({ status: 'error', errors: ['not_found'] })
    expect(getProposalForAccount).not.toHaveBeenCalled()
  })

  it.each(entries)("%s: ANOTHER account's proposal looks exactly like a missing one (lookup is account-scoped)", async (_n, fn) => {
    row = await propose('site_fields', { fields: { price: 9.5 } })
    login('someone-else')
    expect(await fn(ACTION)).toEqual({ status: 'error', errors: ['not_found'] })
    expect(getProposalForAccount).toHaveBeenCalledWith(ACTION, 'someone-else')
    expectNoWrites()
    expect(markRejected).not.toHaveBeenCalled()
    expect(markUndone).not.toHaveBeenCalled()
  })

  it.each(entries)('%s: a proposal on a site the caller no longer owns is forbidden (requireSiteOwner re-run)', async (_n, fn) => {
    row = await propose('site_fields', { fields: { price: 9.5 } })
    state.site = siteRow({ userId: 'new-owner' })
    const res = await fn(ACTION)
    expect(res).toMatchObject({ status: 'error', errors: ['forbidden', 'Not authorized'] })
    expectNoWrites()
  })

  it('a site transferred away from the proposal\'s account is forbidden even for a sudo', async () => {
    row = await propose('site_fields', { fields: { price: 9.5 } })
    state.site = siteRow({ userId: 'new-owner' })
    login('admin-1', true)
    vi.mocked(prisma.assistantAction.findUnique).mockResolvedValue({ accountId: OWNER } as never)
    expect(await applyProposal(ACTION)).toMatchObject({ errors: ['forbidden', 'Not authorized'] })
    expectNoWrites()
  })

  it('a sudo may apply a proposal of ANOTHER account (found via the owner, still account-scoped)', async () => {
    row = await propose('site_fields', { fields: { price: 9.5 } })
    login('admin-1', true)
    vi.mocked(prisma.assistantAction.findUnique).mockResolvedValue({ accountId: OWNER } as never)
    expect(await applyProposal(ACTION)).toMatchObject({ status: 'ok' })
    expect(getProposalForAccount).toHaveBeenCalledWith(ACTION, 'admin-1')
    expect(getProposalForAccount).toHaveBeenCalledWith(ACTION, OWNER)
    expect(markApplied).toHaveBeenCalledWith(ACTION, OWNER, expect.anything(), expect.anything())
  })

  it('a NON-sudo never gets the owner lookup fallback', async () => {
    row = await propose('site_fields', { fields: { price: 9.5 } })
    login('someone-else', false)
    vi.mocked(prisma.assistantAction.findUnique).mockResolvedValue({ accountId: OWNER } as never)
    expect(await applyProposal(ACTION)).toEqual({ status: 'error', errors: ['not_found'] })
    expect(prisma.assistantAction.findUnique).not.toHaveBeenCalled()
  })
})

describe('applyProposal: lifecycle guards', () => {
  it('an expired proposal (past expiresAt) is refused and writes nothing', async () => {
    row = await propose('site_fields', { fields: { price: 9.5 } }, { expiresAt: new Date(Date.now() - 1000) })
    expect(await applyProposal(ACTION)).toEqual({ status: 'error', errors: ['expired'] })
    expectNoWrites()
  })

  it('a row already swept to "expired" is expired, not "already resolved"', async () => {
    row = await propose('site_fields', { fields: { price: 9.5 } }, { status: 'expired' })
    expect(await applyProposal(ACTION)).toEqual({ status: 'error', errors: ['expired'] })
  })

  it.each(['applied', 'rejected', 'undone', 'failed'])('a %s proposal cannot be applied again', async (status) => {
    row = await propose('site_fields', { fields: { price: 9.5 } }, { status })
    expect(await applyProposal(ACTION)).toEqual({ status: 'error', errors: ['already_resolved'] })
    expectNoWrites()
  })

  it('STALE: the data changed after the proposal -> refused, marked failed, nothing written', async () => {
    row = await propose('site_fields', { fields: { price: 9.5 } })
    state.site = siteRow({ price: 11 }) // someone edited the price in the meantime
    expect(await applyProposal(ACTION)).toEqual({ status: 'error', errors: ['stale'] })
    expect(markFailed).toHaveBeenCalledWith(ACTION, OWNER, { error: 'stale' })
    expectNoWrites()
    expect(appendMessages).toHaveBeenCalledWith(CONV, OWNER, [expect.objectContaining({ role: 'user', note: true, content: expect.stringMatching(/^\[failed\].*changed after/) })])
  })

  it('STALE also covers a "create" that has since appeared (the product now exists)', async () => {
    row = await propose('products', { upserts: [{ name: 'Paella', price: 15 }], deletes: [] })
    state.products = [{ id: 'p9', name: 'Paella', description: null, totalPrice: 15, tax: 21, category: 'food', soldOut: false }]
    expect(await applyProposal(ACTION)).toEqual({ status: 'error', errors: ['stale'] })
    expect(products.addProduct).not.toHaveBeenCalled()
  })

  it('an ambiguity that appears at apply time fails the proposal instead of guessing', async () => {
    state.products = [{ id: 'p1', name: 'Mojito', description: null, totalPrice: 8, tax: 10, category: 'drink', soldOut: false }]
    row = await propose('products', { upserts: [{ name: 'Mojito', price: 9 }], deletes: [] })
    state.products.push({ id: 'p2', name: 'mojito', description: null, totalPrice: 8, tax: 10, category: 'drink', soldOut: false })
    const res = await applyProposal(ACTION)
    expect(res).toMatchObject({ status: 'error', errors: ['apply_failed', expect.stringMatching(/2 products named/)] })
    expect(products.updateProduct).not.toHaveBeenCalled()
  })
})

describe('applyProposal: site fields', () => {
  it('runs the EXISTING actions with the merged values, records the snapshot, notes and refreshes', async () => {
    row = await propose('site_fields', { fields: { price: 9.5 } })
    const res = await applyProposal(ACTION)

    expect(res).toEqual({ status: 'ok', summary: 'Changed site price per sunbed (incl. vat) 9 → 9.5' })
    expect(site.saveGeneral).toHaveBeenCalledTimes(1)
    expect(site.saveGeneral).toHaveBeenCalledWith({
      id: SITE, name: 'Playa Azul', type: 'paid', price: '9.5', vat: '21', locationLat: '36.5', locationLng: '-4.9',
    })
    // Untouched tabs are not rewritten.
    expect(content.saveContentFields).not.toHaveBeenCalled()
    expect(site.setSiteStatus).not.toHaveBeenCalled()
    expect(markApplied).toHaveBeenCalledWith(ACTION, OWNER, { price: 9 }, { summary: expect.any(String), steps: ['general'] })
    expect(appendMessages).toHaveBeenCalledWith(CONV, OWNER, [{ role: 'user', content: '[applied] Changed site price per sunbed (incl. vat) 9 → 9.5', note: true }])
    expect(revalidatePath).toHaveBeenCalledWith(`/sites/${SITE}`, 'layout')
  })

  it('description + services go through saveContentFields with the untouched half preserved; status and group booking through their own actions', async () => {
    row = await propose('site_fields', { fields: { description: 'New text', status: 'hidden', partialGroupBooking: true } })
    await applyProposal(ACTION)
    expect(content.saveContentFields).toHaveBeenCalledWith({ id: SITE, description: 'New text', services: ['wc'] })
    expect(site.setSiteStatus).toHaveBeenCalledWith(SITE, 'hidden')
    expect(site.setPartialGroupBooking).toHaveBeenCalledWith(SITE, true)
    expect(site.saveGeneral).not.toHaveBeenCalled()
    expect(vi.mocked(markApplied).mock.calls[0]![2]).toEqual({ description: 'A beach', status: 'active', partialGroupBooking: false })
  })

  it('clearing the price sends an empty price (saveGeneral stores null)', async () => {
    row = await propose('site_fields', { fields: { price: null } })
    await applyProposal(ACTION)
    expect(site.saveGeneral).toHaveBeenCalledWith(expect.objectContaining({ price: '', vat: '21' }))
  })

  it('PARTIAL FAILURE: stops at the failing step, rolls the finished steps back from the snapshot, marks failed with what ran', async () => {
    row = await propose('site_fields', { fields: { price: 9.5, status: 'hidden' } })
    vi.mocked(site.setSiteStatus).mockResolvedValue({ status: 'error', errors: ['Invalid site status'] } as never)

    const res = await applyProposal(ACTION)

    expect(res).toEqual({ status: 'error', errors: ['apply_failed', 'Invalid site status (the steps already done were rolled back)'] })
    // General ran (9 -> 9.5) and was put back (9.5 -> 9) from the snapshot.
    const prices = vi.mocked(site.saveGeneral).mock.calls.map((c) => c[0].price)
    expect(prices).toEqual(['9.5', '9'])
    expect(site.setPartialGroupBooking).not.toHaveBeenCalled()
    expect(markApplied).not.toHaveBeenCalled()
    expect(markFailed).toHaveBeenCalledWith(ACTION, OWNER, {
      error: 'Invalid site status', startedSteps: ['general'], rolledBack: true, snapshot: { price: 9, status: 'active' },
    })
    expect(vi.mocked(appendMessages).mock.calls[0]![2]![0]).toMatchObject({ content: expect.stringMatching(/^\[failed\]/) })
  })

  it('PARTIAL FAILURE whose rollback also fails keeps the snapshot on the row and says so', async () => {
    row = await propose('site_fields', { fields: { price: 9.5, status: 'hidden' } })
    vi.mocked(site.setSiteStatus).mockResolvedValue({ status: 'error', errors: ['nope'] } as never)
    vi.mocked(site.saveGeneral).mockResolvedValueOnce(OK as never).mockResolvedValueOnce({ status: 'error', errors: ['db down'] } as never)
    const res = await applyProposal(ACTION)
    expect(res.status).toBe('error')
    expect(vi.mocked(markFailed).mock.calls[0]![2]).toMatchObject({ startedSteps: ['general'], rolledBack: false, snapshot: { price: 9 } })
    expect((res as any).errors[1]).toMatch(/could not be rolled back/)
  })

  it('a failure on the FIRST step changes nothing and needs no rollback', async () => {
    row = await propose('site_fields', { fields: { price: 9.5 } })
    vi.mocked(site.saveGeneral).mockResolvedValue({ status: 'error', errors: ['Price must be 0–100,000'] } as never)
    const res = await applyProposal(ACTION)
    expect(site.saveGeneral).toHaveBeenCalledTimes(1)
    expect(vi.mocked(markFailed).mock.calls[0]![2]).toMatchObject({ startedSteps: [], rolledBack: false })
    expect((res as any).errors[1]).toMatch(/nothing was changed/)
  })

  it('losing the apply race (markApplied false, other request won) reports already_resolved', async () => {
    row = await propose('site_fields', { fields: { price: 9.5 } })
    vi.mocked(markApplied).mockResolvedValue(false)
    vi.mocked(getProposalForAccount).mockResolvedValueOnce(row as never).mockResolvedValue({ ...row, status: 'applied' } as never)
    expect(await applyProposal(ACTION)).toEqual({ status: 'error', errors: ['already_resolved'] })
  })

  it('a proposal that lapsed while executing is rolled back, not left half-recorded', async () => {
    row = await propose('site_fields', { fields: { price: 9.5 } })
    vi.mocked(markApplied).mockResolvedValue(false)
    vi.mocked(getProposalForAccount).mockResolvedValueOnce(row as never).mockResolvedValue({ ...row, status: 'proposed' } as never)
    expect(await applyProposal(ACTION)).toEqual({ status: 'error', errors: ['expired'] })
    expect(vi.mocked(site.saveGeneral).mock.calls.map((c) => c[0].price)).toEqual(['9.5', '9'])
  })
})

describe('applyProposal: other kinds', () => {
  it('working hours: updates the matching range, adds the extra, deletes the surplus, per day', async () => {
    const r = (id: string, day: number, o: string, c: string) => ({ id, day, openTime: new Date(`2000-01-01T${o}:00.000Z`), closeTime: new Date(`2000-01-01T${c}:00.000Z`) })
    state.hours = [r('a', 1, '09:00', '13:00'), r('b', 1, '15:00', '19:00'), r('c', 2, '10:00', '12:00')]
    row = await propose('working_hours', {
      days: [
        { day: 1, ranges: [{ open: '08:00', close: '14:00' }] },
        { day: 2, ranges: [{ open: '10:00', close: '12:00' }, { open: '14:00', close: '18:00' }] },
        { day: 7, ranges: [{ open: '10:00', close: '14:00' }] },
      ],
    })
    await applyProposal(ACTION)
    expect(hours.updateWorkingHours).toHaveBeenCalledWith('a', { openTime: '08:00', closeTime: '14:00' })
    expect(hours.deleteWorkingHours).toHaveBeenCalledWith('b')
    expect(hours.addWorkingHours).toHaveBeenCalledWith(SITE, { day: '2', openTime: '14:00', closeTime: '18:00' })
    expect(hours.addWorkingHours).toHaveBeenCalledWith(SITE, { day: '7', openTime: '10:00', closeTime: '14:00' })
    expect(hours.updateWorkingHours).toHaveBeenCalledTimes(1) // Tue's first range is unchanged
    expect(vi.mocked(markApplied).mock.calls[0]![2]).toEqual({
      days: [
        { day: 1, ranges: [{ open: '09:00', close: '13:00' }, { open: '15:00', close: '19:00' }] },
        { day: 2, ranges: [{ open: '10:00', close: '12:00' }] },
        { day: 7, ranges: [] },
      ],
    })
  })

  it('products: update sends only the changed fields; create goes through addProduct (gross price + tax, no net maths here); delete last', async () => {
    state.products = [{ id: 'p1', name: 'Mojito', description: null, totalPrice: 8, tax: 10, category: 'drink', soldOut: false }, { id: 'p2', name: 'Old', description: null, totalPrice: 3, tax: 10, category: 'food', soldOut: false }]
    row = await propose('products', { upserts: [{ name: 'Mojito', price: 8.5, soldOut: true }, { name: 'Paella', price: 15, category: 'food' }], deletes: ['Old'] })
    await applyProposal(ACTION)
    expect(products.updateProduct).toHaveBeenCalledWith('p1', { totalPrice: 8.5 })
    expect(products.toggleProductSoldOut).toHaveBeenCalledWith('p1', true)
    const fd = vi.mocked(products.addProduct).mock.calls[0]![0] as FormData
    expect(Object.fromEntries(fd.entries())).toEqual({ siteId: SITE, name: 'Paella', totalPrice: '15', tax: '21', category: 'food' })
    expect(products.deleteProduct).toHaveBeenCalledWith('p2')
    const order = [products.updateProduct, products.addProduct, products.deleteProduct].map((f) => vi.mocked(f).mock.invocationCallOrder[0])
    expect(order).toEqual([...order].sort((a, b) => a! - b!))
    expect(vi.mocked(markApplied).mock.calls[0]![2]).toMatchObject({ created: ['Paella'], existing: [expect.objectContaining({ id: 'p1' }), expect.objectContaining({ id: 'p2' })] })
  })

  it('rentals: update merges the untouched fields, create passes quantity and prices', async () => {
    state.rentals = [{ id: 'r1', name: 'Kayak', description: 'Sea', category: 'boat', pricePerHour: 5, pricePerDay: 20, totalQuantity: 4, active: true }]
    row = await propose('rental_items', { upserts: [{ name: 'Kayak', totalQuantity: 6 }, { name: 'SUP', pricePerDay: 30, totalQuantity: 2 }], deletes: [] })
    await applyProposal(ACTION)
    expect(rentals.updateRentalItem).toHaveBeenCalledWith({
      id: 'r1', siteId: SITE, name: 'Kayak', description: 'Sea', category: 'boat', pricePerHour: 5, pricePerDay: 20, totalQuantity: 6, active: true,
    })
    expect(rentals.createRentalItem).toHaveBeenCalledWith(expect.objectContaining({ siteId: SITE, name: 'SUP', pricePerDay: 30, totalQuantity: 2 }))
  })

  it('brand and slug use saveBrand / saveSlug, keeping the slug and the colours not being changed', async () => {
    state.brand = { brandName: 'Playa', tagline: 'Old', bgColor: '#ffffff', fgColor: '#000000' }
    row = await propose('brand', { fields: { tagline: 'New' } })
    await applyProposal(ACTION)
    expect(site.saveBrand).toHaveBeenCalledWith({ siteId: SITE, brandName: 'Playa', slug: 'playa-azul', tagline: 'New', bgColor: '#ffffff', fgColor: '#000000' })

    vi.clearAllMocks(); wireDb(); login(OWNER)
    vi.mocked(site.checkSlug).mockResolvedValue({ available: true })
    row = await propose('slug', { slug: 'new-address' })
    vi.mocked(markApplied).mockResolvedValue(true); vi.mocked(site.saveSlug).mockResolvedValue(OK as never); vi.mocked(appendMessages).mockResolvedValue({} as never)
    await applyProposal(ACTION)
    expect(site.saveSlug).toHaveBeenCalledWith(SITE, 'new-address')
    expect(vi.mocked(markApplied).mock.calls[0]![2]).toEqual({ slug: 'playa-azul' })
  })

  it('account fields are written to the SITE OWNER\'s account, even when a sudo applies them', async () => {
    state.account = { company: 'Old SL', businessId: null, address: 'a', city: 'Malaga', postalCode: '1', country: 'ES', phoneNumber: '1', email: 'a@b.es', websiteUrl: null }
    row = await propose('account_fields', { fields: { city: 'Marbella' } })
    login('admin-1', true)
    vi.mocked(prisma.assistantAction.findUnique).mockResolvedValue({ accountId: OWNER } as never)
    await applyProposal(ACTION)
    expect(accountFields.applyAccountPatch).toHaveBeenCalledWith(OWNER, { city: 'Marbella' })
    expect(revalidatePath).toHaveBeenCalledWith('/account')
  })

  it('an unknown kind (tampered row) is refused', async () => {
    row = { ...(await propose('site_fields', { fields: { price: 9.5 } })), kind: 'drop_database' }
    expect(await applyProposal(ACTION)).toMatchObject({ status: 'error', errors: ['apply_failed', expect.stringMatching(/Unknown proposal kind/)] })
    expectNoWrites()
  })
})

describe('rejectProposal', () => {
  it('marks the proposal rejected, writes nothing, tells the model', async () => {
    row = await propose('site_fields', { fields: { price: 9.5 } })
    const res = await rejectProposal(ACTION)
    expect(res).toMatchObject({ status: 'ok' })
    expect(markRejected).toHaveBeenCalledWith(ACTION, OWNER)
    expectNoWrites()
    expect(appendMessages).toHaveBeenCalledWith(CONV, OWNER, [expect.objectContaining({ content: expect.stringMatching(/^\[rejected\]/), note: true })])
  })

  it.each(['applied', 'rejected', 'failed'])('cannot reject a %s proposal', async (status) => {
    row = await propose('site_fields', { fields: { price: 9.5 } }, { status })
    expect(await rejectProposal(ACTION)).toEqual({ status: 'error', errors: ['already_resolved'] })
    expect(markRejected).not.toHaveBeenCalled()
  })

  it('an expired proposal reads expired', async () => {
    row = await propose('site_fields', { fields: { price: 9.5 } }, { status: 'expired' })
    expect(await rejectProposal(ACTION)).toEqual({ status: 'error', errors: ['expired'] })
  })

  it('a lost race (markRejected false) is already_resolved', async () => {
    row = await propose('site_fields', { fields: { price: 9.5 } })
    vi.mocked(markRejected).mockResolvedValue(false)
    expect(await rejectProposal(ACTION)).toEqual({ status: 'error', errors: ['already_resolved'] })
  })
})

describe('undoProposal', () => {
  /** An applied site_fields proposal: price 9 -> 9.5, database now holds 9.5. */
  async function applied(over: Row = {}) {
    const r = await propose('site_fields', { fields: { price: 9.5 } }, { status: 'applied', appliedAt: new Date(Date.now() - HOUR), snapshot: { price: 9 }, ...over })
    state.site = siteRow({ price: 9.5 })
    return r
  }

  it('restores the snapshot through the same action, marks undone, tells the model', async () => {
    row = await applied()
    const res = await undoProposal(ACTION)
    expect(res).toMatchObject({ status: 'ok' })
    expect(site.saveGeneral).toHaveBeenCalledWith(expect.objectContaining({ id: SITE, price: '9', vat: '21', name: 'Playa Azul' }))
    expect(markUndone).toHaveBeenCalledWith(ACTION, OWNER)
    expect(appendMessages).toHaveBeenCalledWith(CONV, OWNER, [expect.objectContaining({ content: expect.stringMatching(/^\[undone\]/), note: true })])
    expect(revalidatePath).toHaveBeenCalledWith(`/sites/${SITE}`, 'layout')
  })

  it('refuses outside the 24 h window and writes nothing', async () => {
    row = await applied({ appliedAt: new Date(Date.now() - 25 * HOUR) })
    expect(await undoProposal(ACTION)).toEqual({ status: 'error', errors: ['undo_window'] })
    expect(site.saveGeneral).not.toHaveBeenCalled()
    expect(markUndone).not.toHaveBeenCalled()
  })

  it('STALE: the value was edited after the apply -> refused, the later edit survives', async () => {
    row = await applied()
    state.site = siteRow({ price: 12 })
    expect(await undoProposal(ACTION)).toEqual({ status: 'error', errors: ['stale'] })
    expect(site.saveGeneral).not.toHaveBeenCalled()
    expect(markUndone).not.toHaveBeenCalled()
  })

  it.each(['proposed', 'rejected', 'undone', 'failed'])('only an APPLIED proposal can be undone (%s)', async (status) => {
    row = await applied({ status })
    expect(await undoProposal(ACTION)).toEqual({ status: 'error', errors: ['already_resolved'] })
    expect(site.saveGeneral).not.toHaveBeenCalled()
  })

  it('a second undo (race lost on markUndone) is already_resolved', async () => {
    row = await applied()
    vi.mocked(markUndone).mockResolvedValue(false)
    expect(await undoProposal(ACTION)).toEqual({ status: 'error', errors: ['already_resolved'] })
  })

  it('a row without a snapshot cannot be undone', async () => {
    row = await applied({ snapshot: null })
    expect(await undoProposal(ACTION)).toMatchObject({ errors: ['apply_failed', expect.stringMatching(/snapshot/)] })
  })

  it('products: created ones are removed, updated ones restored; refused while a created one has orders', async () => {
    state.products = [{ id: 'p1', name: 'Mojito', description: null, totalPrice: 8, tax: 10, category: 'drink', soldOut: false }]
    const payload = { upserts: [{ name: 'Mojito', price: 8.5 }, { name: 'Paella', price: 15 }], deletes: [] }
    const r = await propose('products', payload, { status: 'applied', appliedAt: new Date(Date.now() - HOUR) })
    r.snapshot = { existing: [state.products[0]], created: ['Paella'] }
    state.products = [{ ...state.products[0], totalPrice: 8.5 }, { id: 'p5', name: 'Paella', description: null, totalPrice: 15, tax: 21, category: 'food', soldOut: false }]
    row = r

    vi.mocked(prisma.orderItem.count).mockResolvedValue(2)
    expect(await undoProposal(ACTION)).toMatchObject({ errors: ['in_use', expect.stringMatching(/already has orders/)] })
    expect(products.deleteProduct).not.toHaveBeenCalled()
    expect(products.updateProduct).not.toHaveBeenCalled()
    expect(markUndone).not.toHaveBeenCalled()

    vi.mocked(prisma.orderItem.count).mockResolvedValue(0)
    expect(await undoProposal(ACTION)).toMatchObject({ status: 'ok' })
    expect(products.updateProduct).toHaveBeenCalledWith('p1', { description: null, totalPrice: 8, tax: 10, category: 'drink' })
    expect(products.deleteProduct).toHaveBeenCalledWith('p5')
  })

  it('rentals: a created item with bookings blocks the undo', async () => {
    const r = await propose('rental_items', { upserts: [{ name: 'SUP', pricePerDay: 30, totalQuantity: 2 }], deletes: [] }, { status: 'applied', appliedAt: new Date(Date.now() - HOUR) })
    r.snapshot = { existing: [], created: ['SUP'] }
    state.rentals = [{ id: 'r9', name: 'SUP', description: null, category: null, pricePerHour: null, pricePerDay: 30, totalQuantity: 2, active: true }]
    row = r
    vi.mocked(prisma.rentalBooking.count).mockResolvedValue(1)
    expect(await undoProposal(ACTION)).toMatchObject({ errors: ['in_use', expect.stringMatching(/has bookings/)] })
    expect(rentals.deleteRentalItem).not.toHaveBeenCalled()
  })

  it('removals are not undoable: a delete-only proposal says so and changes nothing', async () => {
    state.products = [{ id: 'p2', name: 'Old', description: null, totalPrice: 3, tax: 10, category: 'food', soldOut: false }]
    const r = await propose('products', { upserts: [], deletes: ['Old'] }, { status: 'applied', appliedAt: new Date(Date.now() - HOUR) })
    r.snapshot = { existing: [state.products[0]], created: [] }
    state.products = []
    row = r
    expect(await undoProposal(ACTION)).toMatchObject({ errors: ['not_undoable', expect.any(String)] })
    expect(products.updateProduct).not.toHaveBeenCalled()
    expect(markUndone).not.toHaveBeenCalled()
  })

  it('a mixed proposal undoes the rest but never resurrects the removed product, and the note says so', async () => {
    state.products = [
      { id: 'p1', name: 'Mojito', description: null, totalPrice: 8, tax: 10, category: 'drink', soldOut: false },
      { id: 'p2', name: 'Old', description: null, totalPrice: 3, tax: 10, category: 'food', soldOut: false },
    ]
    const r = await propose('products', { upserts: [{ name: 'Mojito', price: 8.5 }], deletes: ['Old'] }, { status: 'applied', appliedAt: new Date(Date.now() - HOUR) })
    r.snapshot = { existing: [state.products[0], state.products[1]], created: [] }
    state.products = [{ ...state.products[0], totalPrice: 8.5 }]
    row = r
    const res = await undoProposal(ACTION)
    expect(res).toMatchObject({ status: 'ok', summary: expect.stringContaining('removed items are not restored') })
    expect(products.updateProduct).toHaveBeenCalledTimes(1)
    expect(products.updateProduct).toHaveBeenCalledWith('p1', expect.objectContaining({ totalPrice: 8 }))
  })

  it('brand created by the apply is removed on undo (no brand existed before)', async () => {
    state.brand = null
    const r = await propose('brand', { fields: { brandName: 'Playa' } }, { status: 'applied', appliedAt: new Date(Date.now() - HOUR) })
    r.snapshot = { brand: null }
    state.brand = { brandName: 'Playa', tagline: null, bgColor: '#faf9f6', fgColor: '#111827' }
    row = r
    expect(await undoProposal(ACTION)).toMatchObject({ status: 'ok' })
    expect(prisma.siteBrand.delete).toHaveBeenCalledWith({ where: { siteId: SITE } })
    expect(site.saveBrand).not.toHaveBeenCalled()
  })

  it('account fields: restores the prior values + tax identity for the owner account', async () => {
    state.account = { company: 'Old SL', businessId: 'B1', address: 'a', city: 'Malaga', postalCode: '1', country: 'ES', phoneNumber: '1', email: 'a@b.es', websiteUrl: null }
    const r = await propose('account_fields', { fields: { city: 'Marbella' } }, { status: 'applied', appliedAt: new Date(Date.now() - HOUR) })
    r.snapshot = { values: { city: 'Malaga' } }
    state.account = { ...state.account, city: 'Marbella' }
    row = r
    expect(await undoProposal(ACTION)).toMatchObject({ status: 'ok' })
    expect(accountFields.restoreAccountFields).toHaveBeenCalledWith(OWNER, { values: { city: 'Malaga' } })
  })
})

describe('sql snapshot invalidation (track 030 G1)', () => {
  /** A stand-in cached snapshot for SITE; `close` proves it was disposed. */
  function cacheFor(siteId: string) {
    const close = vi.fn(async () => {})
    snapshotCache.cacheSet(siteId, { promise: Promise.resolve({ db: { close } }), expiresAt: Date.now() + HOUR })
    return close
  }
  beforeEach(() => snapshotCache.resetSnapshotCache())

  it("an applied proposal drops that site's data copy (the next sql call reloads), other sites keep theirs", async () => {
    const mine = cacheFor(SITE)
    const other = cacheFor('other-site')
    row = await propose('site_fields', { fields: { price: 9.5 } })
    expect(await applyProposal(ACTION)).toMatchObject({ status: 'ok' })
    expect(snapshotCache.cachedSiteIds()).toEqual(['other-site'])
    await Promise.resolve()
    expect(mine).toHaveBeenCalled()
    expect(other).not.toHaveBeenCalled()
  })

  it('an undo drops it too', async () => {
    cacheFor(SITE)
    row = await propose('site_fields', { fields: { price: 9.5 } }, { status: 'applied', appliedAt: new Date(Date.now() - HOUR), snapshot: { price: 9 } })
    state.site = siteRow({ price: 9.5 })
    expect(await undoProposal(ACTION)).toMatchObject({ status: 'ok' })
    expect(snapshotCache.cachedSiteIds()).toEqual([])
  })

  it('a rejected proposal changed nothing and keeps the copy', async () => {
    cacheFor(SITE)
    row = await propose('site_fields', { fields: { price: 9.5 } })
    expect(await rejectProposal(ACTION)).toMatchObject({ status: 'ok' })
    expect(snapshotCache.cachedSiteIds()).toEqual([SITE])
  })
})
