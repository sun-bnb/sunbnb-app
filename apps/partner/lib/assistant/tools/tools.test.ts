/**
 * The assistant's read-only tools (track 030 S2): site binding, per-call ownership, handle
 * resolution within the site, strict schemas and compact result shapes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('@repo/data/flags', () => ({ getFlagStates: vi.fn() }))
vi.mock('@/app/sites/[id]/parcels', () => ({ getParcelSummaries: vi.fn() }))
vi.mock('@repo/data/coastline-lookup', () => ({ shoreAround: vi.fn() }))
vi.mock('@/app/sites/[id]/item-counts', () => ({ getSiteItemCounts: vi.fn() }))

import { executeToolCall } from '@repo/agent/loop'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getMonthlySourceSummary, getRevenueByChannelByDay } from '@repo/data/analytics'
import { shoreAround } from '@repo/data/coastline-lookup'
import { getParcelSummaries } from '@/app/sites/[id]/parcels'
import { getSiteItemCounts } from '@/app/sites/[id]/item-counts'
import { getAssistantTools, toolLabel, type AssistantToolCtx } from './index'
import { elementHandle, maskIban, storedSeatLabel } from './helpers'
import { parseMonth } from './accounting'

const OWNER = 'owner-1'
const SITE = 'site-1'
const ctx: AssistantToolCtx = { session: {}, accountId: OWNER, siteId: SITE, locale: 'en' }

const tools = getAssistantTools()

async function call(name: string, input: Record<string, unknown> = {}, c: AssistantToolCtx = ctx) {
  const ex = await executeToolCall(tools, { id: 't1', name, arguments: JSON.stringify(input) }, c)
  return ex
}
async function result(name: string, input: Record<string, unknown> = {}) {
  const ex = await call(name, input)
  expect(ex.errors).toEqual([])
  return ex.result as Record<string, any>
}

const parcel = (group: number, over: Record<string, unknown> = {}) => ({
  group, count: 8, itemGroupId: `ig${group}`, rows: 2, seatsPerRow: 4, horizontalGap: 1, verticalGap: 1.5, pairGap: 0.4,
  rotation: 15, locationLat: '1', locationLng: '2', schematicX: null, schematicY: null, category: 'PRICE1', price: 9, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(auth).mockResolvedValue({ user: { id: OWNER } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as never)
  vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER } as never)
  vi.mocked(getParcelSummaries).mockResolvedValue({ parcels: [parcel(1), parcel(2)], ungroupedCount: 3 })
})

describe('registry', () => {
  it('is the S2 read set plus the S3-S8 proposal-only tools, every schema strict (additionalProperties:false, object)', () => {
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'explain_feature', 'find_seats', 'get_account_profile', 'get_accounting_summary', 'get_brand', 'get_content',
        'get_parcel', 'get_revenue_trend', 'get_site_overview', 'get_working_hours', 'list_layout_elements',
        'list_parcels', 'measure_parcels', 'measure_to_sea', 'describe_site_area', 'measure', 'list_products', 'list_rental_items',
        'propose_account_fields', 'propose_brand', 'propose_products', 'propose_rental_items', 'propose_site_fields',
        'propose_slug', 'propose_working_hours',
        'propose_canvas_size', 'propose_create_parcel', 'propose_edit_parcel', 'propose_layout_elements', 'propose_rotate', 'propose_spacing', 'propose_move',
        'propose_set_status', 'propose_reverse', 'propose_delete', 'request_qr_print', 'propose_place_image', 'extract_schematic_from_plan',
        'request_photo_alignment', 'propose_layout_from_photo', 'sql', 'run_js', 'inspect',
      ].sort(),
    )
    for (const t of tools) {
      expect(t.inputSchema.type).toBe('object')
      expect(t.inputSchema.additionalProperties).toBe(false)
      expect(t.label.length).toBeGreaterThan(3)
    }
  })

  it('no tool exposes a site/account id parameter: the model cannot choose the site', () => {
    for (const t of tools) {
      const props = Object.keys((t.inputSchema.properties as object) ?? {})
      expect(props.filter((p) => /^(site|account|owner|user)[_-]?(id)?$/i.test(p))).toEqual([])
    }
  })

  it('toolLabel falls back to the name for an unknown tool', () => {
    expect(toolLabel('list_parcels')).toBe('Reading parcels')
    expect(toolLabel('mystery')).toBe('mystery')
  })

  it.each(tools.map((t) => t.name))('%s rejects an injected siteId (strict schema), without running', async (name) => {
    const ex = await call(name, { siteId: 'other-site', topic: 'parcel-edit', month: '2026-01', days: 7, parcel: 1 })
    // Either the extra key or a required-field problem rejects it; in no case does it run.
    expect(ex.accepted).toBe(false)
    expect(ex.errors.join(' ')).toMatch(/siteId|unexpected|additional/i)
    expect(prisma.site.findUnique).not.toHaveBeenCalled()
  })
})

describe('per-call ownership', () => {
  it('a caller who does not own ctx.siteId gets forbidden and no data is read', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'intruder' } } as never)
    const r = await result('list_parcels')
    expect(r).toEqual({ ok: false, error: 'forbidden' })
    expect(getParcelSummaries).not.toHaveBeenCalled()
    expect(prisma.inventoryItem.groupBy).not.toHaveBeenCalled()
  })

  it('a signed-out caller is forbidden too', async () => {
    vi.mocked(auth).mockResolvedValue(null)
    expect(await result('get_brand')).toEqual({ ok: false, error: 'forbidden' })
    expect(prisma.siteBrand.findUnique).not.toHaveBeenCalled()
  })

  it('sudo passes the ownership check', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: 'admin' } } as never)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: true } as never)
    vi.mocked(prisma.inventoryItem.groupBy).mockResolvedValue([])
    expect((await result('list_parcels')).parcels).toHaveLength(2)
  })

  it('a thrown data error becomes tool_failed, not a crashed turn', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getParcelSummaries).mockRejectedValue(new Error('db down'))
    expect(await result('list_parcels')).toEqual({ ok: false, error: 'tool_failed' })
    spy.mockRestore()
  })
})

describe('parcels', () => {
  it('list_parcels returns compact rows with a status breakdown per parcel', async () => {
    vi.mocked(prisma.inventoryItem.groupBy).mockResolvedValue([
      { group: 1, status: 'active', _count: { _all: 7 } },
      { group: 1, status: 'disabled', _count: { _all: 1 } },
      { group: 2, status: 'active', _count: { _all: 8 } },
    ] as never)
    const r = await result('list_parcels')
    expect(prisma.inventoryItem.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ siteId: SITE }) }))
    expect(getParcelSummaries).toHaveBeenCalledWith(SITE)
    expect(r.ungroupedSeats).toBe(3)
    expect(r.parcels[0]).toEqual({
      parcel: 1, seats: 8, rows: 2, seatsPerRow: 4, rotationDegrees: 15,
      gapsMetres: { betweenSeats: 1, betweenRows: 1.5, betweenPairedBeds: 0.4 },
      category: 'PRICE1', price: 9, statuses: { active: 7, disabled: 1 },
      position: expect.objectContaining({ centre: { lat: expect.any(Number), lng: expect.any(Number) }, sizeM: expect.any(Object), rowBearingDegrees: expect.any(Number) }),
    })
    // compact: no corners / anchor in the list
    expect(r.parcels[0].position.corners).toBeUndefined()
    expect(JSON.stringify(r)).not.toMatch(/ig1|locationLat|itemGroupId/)
  })

  it('get_parcel carries the full position (anchor, centre, size, bearing, 4 corners)', async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as never)
    const r = await result('get_parcel', { parcel: 1 })
    expect(r.position.anchor).toEqual({ lat: 1, lng: 2 })
    expect(r.position.corners).toHaveLength(4)
  })

  it('measure_parcels: schematic positions in metres, the model gets a ready by_m', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER, layoutMode: 'schematic' } as never)
    vi.mocked(getParcelSummaries).mockResolvedValue({
      parcels: [
        parcel(4, { rows: 1, seatsPerRow: 1, rotation: 0, pairGap: 0, locationLat: null, locationLng: null, schematicX: 0, schematicY: 0 }),
        parcel(5, { rows: 1, seatsPerRow: 1, rotation: 0, pairGap: 0, locationLat: null, locationLng: null, schematicX: 20, schematicY: 0 }),
      ],
      ungroupedCount: 0,
    })
    const r = await result('measure_parcels', { from: 5, to: 4 })
    expect(r).toMatchObject({ from: 5, to: 4, edgeGapM: 17.9, targetGapM: 2, direction: { dx: -1, dy: 0 }, by_m: { dx: -15.9, dy: 0 } })
  })

  it('measure_parcels: unknown parcel, same parcel and bad input are rejected', async () => {
    expect(await result('measure_parcels', { from: 1, to: 99 })).toEqual({ ok: false, error: 'parcel_not_found' })
    expect((await result('measure_parcels', { from: 1, to: 1 })).ok).toBe(false)
    expect((await call('measure_parcels', { from: 1 })).accepted).toBe(false)
  })

  it('measure_to_sea (map): reads the shoreline and returns bearing, distance and a ready by_m', async () => {
    const M = 111320
    // parcel at lat 1 / lng 2; shore runs north about 60 m east of it, sea to the east (water on the right).
    const lng = 2 + 60 / (M * Math.cos(Math.PI / 180))
    vi.mocked(shoreAround).mockResolvedValue({ ways: [[{ lat: 0.99, lng }, { lat: 1.01, lng }]], water: [] } as never)
    vi.mocked(getParcelSummaries).mockResolvedValue({ parcels: [parcel(4, { rotation: 0 }), parcel(5, { rotation: 0, locationLat: '1', locationLng: '1.9998' })], ungroupedCount: 0 })
    const r = await result('measure_to_sea', { parcels: [4, 5], target_distance_m: 5 })
    expect(shoreAround).toHaveBeenCalledWith(1, 2, 1500)
    expect(r.parcels[0].seaBearingDegrees).toBe(90)
    expect(r.parcels[0].distanceToWaterM).toBeGreaterThan(40)
    expect(r.shared.basedOnParcel).toBe(4)
    expect(r.shared.by_m.dx).toBeGreaterThan(30)
    expect(r.shared.resultingDistancesM[4]).toBeCloseTo(5, 0)
  })

  it('measure_to_sea: no shore, a lookup error and an unknown parcel are ok:false (the model falls back to asking)', async () => {
    vi.mocked(shoreAround).mockResolvedValue({ ways: [], water: [] } as never)
    expect(await result('measure_to_sea', { parcels: [1] })).toMatchObject({ ok: false, reason: 'no_shore_within_1500m' })
    vi.mocked(shoreAround).mockRejectedValue(new Error('no env'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await result('measure_to_sea', { parcels: [1] })).toMatchObject({ ok: false, reason: 'coastline_unavailable' })
    expect(await result('measure_to_sea', { parcels: [99] })).toEqual({ ok: false, error: 'parcel_not_found' })
    expect((await call('measure_to_sea', { parcels: [] })).accepted).toBe(false)
  })

  it('measure_to_sea (schematic): water elements are the sea; no water element is a reason', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER, layoutMode: 'schematic' } as never)
    vi.mocked(getParcelSummaries).mockResolvedValue({
      parcels: [parcel(4, { rows: 1, seatsPerRow: 1, rotation: 0, pairGap: 0, locationLat: null, locationLng: null, schematicX: 20, schematicY: 10 })],
      ungroupedCount: 0,
    })
    vi.mocked(prisma.layoutElement.findMany).mockResolvedValue([] as never)
    expect(await result('measure_to_sea', { parcels: [4] })).toMatchObject({ ok: false, reason: 'no_water_in_the_schematic' })
    vi.mocked(prisma.layoutElement.findMany).mockResolvedValue([{ type: 'water', x: 0, y: 30, width: 40, height: 10, rotation: 0 }] as never)
    const r = await result('measure_to_sea', { parcels: [4], target_distance_m: 5 })
    expect(r.parcels[0].seaBearingDegrees).toBe(180)
    expect(r.parcels[0].by_m.dy).toBeLessThan(0)
    expect(r.parcels[0].resultingDistanceM).toBeCloseTo(5, 0)
    expect(prisma.layoutElement.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { siteId: SITE, type: 'water' } }))
  })

  it('get_parcel for a parcel number that is not on THIS site is parcel_not_found and reads no seats', async () => {
    // Parcel 7 exists on some other site; getParcelSummaries(SITE) does not list it.
    expect(await result('get_parcel', { parcel: 7 })).toEqual({ ok: false, error: 'parcel_not_found' })
    expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled()
  })

  it('get_parcel summarises units, pairs and seat ids from the site-scoped seat query', async () => {
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { number: 10101, seatLabel: '1-101-1', status: 'active', sunbedGroupId: 'u1', label: 'VIP', price: 20 },
      { number: 10102, seatLabel: '1-101-2', status: 'active', sunbedGroupId: 'u1', label: null, price: null },
      { number: 10103, seatLabel: '1-102-1', status: 'disabled', sunbedGroupId: 'u2', label: null, price: null },
    ] as never)
    const r = await result('get_parcel', { parcel: 1 })
    expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { siteId: SITE, group: 1, status: { not: 'pool' } } }),
    )
    expect(r).toMatchObject({
      parcel: 1, units: 2, pairedUnits: 1, statuses: { active: 2, disabled: 1 },
      firstSeat: '1-1-1-1', lastSeat: '1-1-2-1', seatsWithOwnPrice: 1,
      labelledSeats: [{ seat: '1-1-1-1', label: 'VIP' }],
    })
  })

  it('rejects a non-integer or out-of-range parcel', async () => {
    expect((await call('get_parcel', { parcel: 1.5 })).accepted).toBe(false)
    expect((await call('get_parcel', { parcel: 0 })).accepted).toBe(false)
    expect((await call('get_parcel', {})).accepted).toBe(false)
  })
})

describe('find_seats', () => {
  beforeEach(() => {
    vi.mocked(prisma.inventoryItem.count).mockResolvedValue(1)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { number: 10203, seatLabel: '1-203-2', status: 'active', group: 1, label: 'A1', price: null, category: null },
    ] as never)
  })
  const whereOf = () => (vi.mocked(prisma.inventoryItem.findMany).mock.calls[0]![0] as { where: Record<string, unknown> }).where

  it('translates a displayed seat id to the stored label, always scoped by siteId, never listing pool seats', async () => {
    const r = await result('find_seats', { query: '1-2-3-2' })
    expect(whereOf()).toEqual({ siteId: SITE, status: { not: 'pool' }, seatLabel: '1-203-2' })
    expect(r).toEqual({
      total: 1, truncated: false,
      seats: [{ seat: '1-2-3-2', parcel: 1, status: 'active', label: 'A1', price: null, category: null }],
    })
  })

  it('a unit address (3 parts) matches all members by prefix', async () => {
    await result('find_seats', { query: '1-2-3' })
    expect(whereOf().seatLabel).toEqual({ startsWith: '1-203-' })
  })

  it('free text searches the custom label; filters add status and parcel', async () => {
    await result('find_seats', { query: 'vip', status: 'disabled', parcel: 4 })
    expect(whereOf()).toEqual({
      siteId: SITE, status: 'disabled', group: 4, label: { contains: 'vip', mode: 'insensitive' },
    })
  })

  it('caps the page size and reports truncation', async () => {
    vi.mocked(prisma.inventoryItem.count).mockResolvedValue(300)
    const r = await result('find_seats', { limit: 50 })
    expect(vi.mocked(prisma.inventoryItem.findMany).mock.calls[0]![0]).toMatchObject({ take: 50 })
    expect(r.truncated).toBe(true)
    expect(r.total).toBe(300)
    expect((await call('find_seats', { limit: 51 })).accepted).toBe(false)
    expect((await call('find_seats', { status: 'pool' })).accepted).toBe(false)
  })
})

describe('layout elements', () => {
  const el = (id: string, over: Record<string, unknown> = {}) => ({
    id, type: 'pool', shape: 'ellipse', label: 'POOL', x: 1.234, y: 2, width: 12, height: 6, rotation: 0, z: 0, ...over,
  })

  it('returns short handles, rounded metres, and never the raw id', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER, layoutMode: 'schematic' } as never)
    vi.mocked(prisma.layoutElement.findMany).mockResolvedValue([el('ckabcdefghij123456')] as never)
    const r = await result('list_layout_elements')
    expect(prisma.layoutElement.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { siteId: SITE } }))
    expect(r.elements[0]).toMatchObject({ element: '123456', type: 'pool', x: 1.23, layer: 0 })
    expect(JSON.stringify(r)).not.toContain('ckabcdefghij')
  })

  it('an element handle that is not among THIS site\'s elements is element_not_found', async () => {
    vi.mocked(prisma.layoutElement.findMany).mockResolvedValue([el('aaaaaaaaaaaaa111111')] as never)
    expect(await result('list_layout_elements', { element: '999999' })).toEqual({ ok: false, error: 'element_not_found' })
  })

  it('resolves a handle among the site\'s own elements', async () => {
    vi.mocked(prisma.layoutElement.findMany).mockResolvedValue([el('aaaaaaaaaaaaa111111'), el('bbbbbbbbbbbbb222222', { type: 'bar' })] as never)
    const r = await result('list_layout_elements', { element: '222222' })
    expect(r.elements).toHaveLength(1)
    expect(r.elements[0].type).toBe('bar')
  })
})

describe('catalog + site tabs', () => {
  it('list_products is site-scoped, filters by name and returns compact rows', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { name: 'Mojito', category: 'drink', totalPrice: 9.5, tax: 10, active: true, soldOut: false, prepTime: 5, imageUrl: 'https://x/y.png' },
    ] as never)
    const r = await result('list_products', { name: 'moj' })
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { siteId: SITE, name: { contains: 'moj', mode: 'insensitive' } } }),
    )
    expect(r.products[0]).toEqual({ name: 'Mojito', category: 'drink', price: 9.5, taxPercent: 10, active: true, soldOut: false, prepMinutes: 5, hasImage: true })
    expect(JSON.stringify(r)).not.toContain('https://x')
  })

  it('list_rental_items is site-scoped', async () => {
    vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
      { name: 'Kayak', category: 'kayak', totalQuantity: 4, pricePerHour: 8, pricePerDay: null, active: true, imageUrl: null },
    ] as never)
    const r = await result('list_rental_items')
    expect(prisma.rentalItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { siteId: SITE } }))
    expect(r.items[0]).toMatchObject({ name: 'Kayak', quantity: 4, pricePerHour: 8, hasImage: false })
  })

  it('get_working_hours formats HH:MM and names the weekday', async () => {
    vi.mocked(prisma.siteWorkingHours.findMany).mockResolvedValue([
      { day: 1, openTime: new Date('2000-01-01T09:00:00.000Z'), closeTime: new Date('2000-01-01T20:30:00.000Z') },
      { day: 7, openTime: new Date('2000-01-01T10:00:00.000Z'), closeTime: new Date('2000-01-01T18:00:00.000Z') },
    ] as never)
    expect(await result('get_working_hours')).toEqual({
      ranges: [{ day: 'Monday', open: '09:00', close: '20:30' }, { day: 'Sunday', open: '10:00', close: '18:00' }],
    })
  })

  it('get_brand reports presence of images, not their URLs', async () => {
    vi.mocked(prisma.siteBrand.findUnique).mockResolvedValue({
      brandName: 'Playa', tagline: 't', primaryColor: '#111', accentColor: null, bgColor: null, fgColor: null,
      logoUrl: 'https://blob/x.png', bgImageUrl: null,
    } as never)
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER, slug: 'playa', customBrandEnabled: false } as never)
    const r = await result('get_brand')
    expect(r).toMatchObject({ configured: true, brandName: 'Playa', slug: 'playa', hasLogo: true, hasBackgroundImage: false })
    expect(JSON.stringify(r)).not.toContain('blob')
  })

  it('get_content truncates a long description and reports cover image yes/no', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER, description: 'x'.repeat(1500), services: ['wc'], image: 'https://u' } as never)
    const r = await result('get_content')
    expect(r.description.length).toBeLessThan(1010)
    expect(r).toMatchObject({ services: ['wc'], hasCoverImage: true })
    expect(JSON.stringify(r)).not.toContain('https://u')
  })

  it('get_account_profile masks the bank account and omits provider tokens', async () => {
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({
      firstName: 'A', lastName: 'B', email: 'a@b.c', phoneNumber: '1', company: 'Co', websiteUrl: null, address: 'St 1',
      city: 'Palma', postalCode: '1', country: 'ES', bankAccount: 'ES9121000418450200051332', businessId: 'B1',
      vatIdStatus: 'valid', taxRegion: null, invoiceSeriesPrefix: 'AB', paymentProvider: 'stripe',
    } as never)
    const r = await result('get_account_profile')
    expect(prisma.partnerAccount.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: OWNER } }))
    expect(r.bankAccountMasked).toBe('ES••••1332')
    expect(JSON.stringify(r)).not.toContain('9121000418450200051332')
    expect(JSON.stringify(r)).not.toMatch(/token/i)
  })

  it('get_site_overview combines counts and payment readiness without secrets', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue({
      userId: OWNER, name: 'Playa', type: 'paid', status: 'active', layoutMode: 'geo', layoutWidth: null, layoutHeight: null,
      price: 12, vat: 10, rentalVat: 21, features: ['sunbeds'], slug: 'playa', timeZone: null, appSalesEnabled: true,
      orderPaymentType: 'paid', rentalPaymentType: null, partialGroupBookingEnabled: false, noShowDeadlineMinutes: null, image: 'u',
    } as never)
    vi.mocked(getSiteItemCounts).mockResolvedValue({ itemCount: 16, activeItemCount: 15, availableTodayCount: 12 })
    vi.mocked(prisma.product.count).mockResolvedValue(4)
    vi.mocked(prisma.rentalItem.count).mockResolvedValue(2)
    vi.mocked(prisma.layoutElement.count).mockResolvedValue(0)
    vi.mocked(prisma.siteWorkingHours.count).mockResolvedValue(7)
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({
      country: 'ES', paymentProvider: 'mollie', mollieAccessToken: 'SECRET-TOKEN', mollieOnboardingStatus: 'completed',
      stripeConnectRequirementsDue: [],
    } as never)
    const r = await result('get_site_overview')
    expect(r).toMatchObject({
      name: 'Playa', status: 'active', layoutMode: 'geo', pricePerSunbed: 12, vatPercent: 10,
      counts: { sunbeds: 16, activeSunbeds: 15, parcels: 2, ungroupedSunbeds: 3, products: 4, workingHourRanges: 7 },
      payments: { provider: 'mollie', ready: true, status: 'ready' },
    })
    expect(JSON.stringify(r)).not.toContain('SECRET-TOKEN')
  })
})

describe('accounting', () => {
  it('parseMonth accepts only YYYY-MM with a real month', () => {
    expect(parseMonth('2026-09')).toEqual({ year: 2026, month: 9 })
    for (const bad of ['2026-13', '2026-00', '26-09', '2026-9', '1999-01', '2026-09-01', 5, null]) expect(parseMonth(bad)).toBeNull()
  })

  it('get_accounting_summary reads the requested month and the previous one for the site', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER, timeZone: 'Europe/Madrid', locationLat: '39.5', locationLng: '2.6' } as never)
    const summary = (total: number) => ({
      sunbeds: { revenue: total, count: 3, seats: 5 }, rentals: { revenue: 0, count: 0 },
      orders: { revenue: 10, count: 1, bedLinkedRevenue: 4 }, refunds: { revenue: 0, count: 0 },
      total, totalCount: 4, capacity: 20,
    })
    vi.mocked(getMonthlySourceSummary).mockResolvedValueOnce(summary(200) as never).mockResolvedValueOnce(summary(150) as never)
    const r = await result('get_accounting_summary', { month: '2026-01' })
    expect(r).toMatchObject({ month: '2026-01', total: 200, previousMonthTotal: 150, bedCapacity: 20, orders: { revenue: 10, count: 1 } })
    expect(getMonthlySourceSummary).toHaveBeenCalledTimes(2)
    for (const c of vi.mocked(getMonthlySourceSummary).mock.calls) expect(c[0]).toBe(SITE)
    // January's previous month is December of the year before.
    const [from, to] = [vi.mocked(getMonthlySourceSummary).mock.calls[1]![1], vi.mocked(getMonthlySourceSummary).mock.calls[1]![2]]
    expect(from.getUTCFullYear()).toBe(2025)
    expect(to.getTime()).toBeGreaterThan(from.getTime())
  })

  it('rejects a malformed month as invalid_month without querying', async () => {
    expect(await result('get_accounting_summary', { month: '2026-13' })).toEqual({ ok: false, error: 'invalid_month' })
    expect(getMonthlySourceSummary).not.toHaveBeenCalled()
  })

  it('get_revenue_trend returns channel totals and compact daily rows; 365 days roll up to months', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER, timeZone: 'Europe/Madrid', locationLat: '39.5', locationLng: '2.6' } as never)
    const rows = [
      { date: '2026-09-01', cash: 10, qr: 0, online: 5, total: 15 },
      { date: '2026-09-02', cash: 0, qr: 20, online: 0, total: 20 },
      { date: '2026-10-01', cash: 5, qr: 0, online: 0, total: 5 },
    ]
    vi.mocked(getRevenueByChannelByDay).mockResolvedValue(rows as never)
    const { summarizeRevenueByChannel } = await import('@repo/data/analytics')
    vi.mocked(summarizeRevenueByChannel).mockReturnValue({ total: 40, cash: 15, qr: 20, online: 5, bestDay: rows[1] } as never)

    const week = await result('get_revenue_trend', { days: 7 })
    expect(week).toMatchObject({ days: 7, total: 40, cash: 15, qr: 20, online: 5, bestDay: { date: '2026-09-02', total: 20 } })
    expect(week.series).toEqual([{ date: '2026-09-01', total: 15 }, { date: '2026-09-02', total: 20 }, { date: '2026-10-01', total: 5 }])

    const year = await result('get_revenue_trend', { days: 365 })
    expect(year.series).toEqual([{ month: '2026-09', total: 35 }, { month: '2026-10', total: 5 }])
    expect((await call('get_revenue_trend', { days: 14 })).accepted).toBe(false)
  })
})

describe('explain_feature', () => {
  it('returns the section text for a known topic and refuses an unknown one', async () => {
    const r = await result('explain_feature', { topic: 'rotate-spacing' })
    expect(r.title).toMatch(/Rotate and spacing/)
    expect(r.text).toContain('15 degrees')
    expect((await call('explain_feature', { topic: 'no-such-topic' })).accepted).toBe(false)
  })
})

describe('pure helpers', () => {
  it('storedSeatLabel maps displayed ids to stored labels (and rejects junk)', () => {
    expect(storedSeatLabel('1-2-3-2')).toEqual({ label: '1-203-2', unitPrefix: '1-203-' })
    expect(storedSeatLabel('12-10-3')).toEqual({ label: '12-1003-', unitPrefix: '12-1003-' })
    expect(storedSeatLabel('A1')).toBeNull()
    expect(storedSeatLabel('1-2')).toBeNull()
  })
  it('elementHandle is the id tail; maskIban keeps country and last 4', () => {
    expect(elementHandle('cl0123456789abcdef')).toBe('abcdef')
    expect(maskIban('ES91 2100 0418 4502 0005 1332')).toBe('ES••••1332')
    expect(maskIban('123')).toBe('••••')
    expect(maskIban(null)).toBeNull()
  })
})
