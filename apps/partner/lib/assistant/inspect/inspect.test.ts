/**
 * The system inspector (track 030 G3): every aspect is read-only, bound to the route's site/account,
 * compact, and generated from the live registries (snapshot schema, registered propose tools) rather
 * than hand-copied.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('@repo/data/flags', () => ({
  getFlagStates: vi.fn(),
  FLAG_REGISTRY: {
    assistant: { name: 'assistant', description: 'Partner AI assistant. Per-customer pilot flag.', defaults: {} },
    devices: { name: 'devices', description: 'Sunbed indicator devices.', defaults: {} },
  },
}))
vi.mock('@repo/data/coastline-lookup', () => ({ shoreAround: vi.fn() }))
vi.mock('@/app/sites/[id]/parcels', () => ({ getParcelSummaries: vi.fn() }))
vi.mock('@/app/sites/[id]/item-counts', () => ({ getSiteItemCounts: vi.fn() }))
vi.mock('@repo/data/payment', async (importOriginal) => ({ ...(await importOriginal<object>()), getSiteFeeContext: vi.fn() }))
vi.mock('../tools/spatial-data', async (importOriginal) => ({ ...(await importOriginal<object>()), loadSiteBase: vi.fn(), loadSeaModel: vi.fn() }))

const registry = vi.hoisted(() => ({ extra: [] as unknown[], hide: [] as string[] }))
vi.mock('./tool-source', () => ({
  registeredTools: async () => {
    const { getAssistantTools } = await import('../tools')
    return [...getAssistantTools().filter((t) => !registry.hide.includes(t.name)), ...registry.extra]
  },
}))

import { executeToolCall } from '@repo/agent/loop'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { getFlagStates } from '@repo/data/flags'
import { getEffectiveSubscriptionForUser } from '@repo/data/subscription'
import { getSiteFeeContext } from '@repo/data/payment'
import { LAUNCH_PROMOTION } from '@repo/data/promotion'
import { getSiteItemCounts } from '@/app/sites/[id]/item-counts'
import { getAssistantTools, type AssistantToolCtx } from '../tools'
import { defineTool, type AssistantTool } from '../tools/helpers'
import { loadSeaModel, loadSiteBase } from '../tools/spatial-data'
import { knowledgeTopicIds } from '../knowledge'
import { buildDatabase } from '../snapshot/load'
import { DENIED_COLUMN, SNAPSHOT_TABLES, SNAPSHOT_VIEWS } from '../snapshot/schema'
import { checkSql, runReadOnly } from '../tools/sql'
import { INSPECT_ASPECTS, INSPECT_PROVIDERS, MAX_INSPECT_BYTES } from './index'
import { RELATIONSHIPS } from './data'
import { describeEditor, OP_META, referencedKnowledgeTopics } from './editor'
import { fitToBudget } from './fit'

const OWNER = 'owner-1'
const SITE = 'site-1'
const ctx: AssistantToolCtx = { session: {}, accountId: OWNER, siteId: SITE, locale: 'en' }
const tools = getAssistantTools()

async function call(input: Record<string, unknown>, c: AssistantToolCtx = ctx) {
  return executeToolCall(tools, { id: 't1', name: 'inspect', arguments: JSON.stringify(input) }, c)
}
async function inspect(aspect: string, topic?: string) {
  const ex = await call({ aspect, ...(topic ? { topic } : {}) })
  expect(ex.errors).toEqual([])
  return ex.result as Record<string, any>
}
const size = (v: unknown) => JSON.stringify(v).length

const siteRow = (over: Record<string, unknown> = {}) => ({
  userId: OWNER, name: 'Playa', type: 'paid', status: 'active', layoutMode: 'geo', locationLat: '39.5', locationLng: '2.6', price: 10, vat: 21,
  image: 'https://img', orderPaymentType: 'paid', rentalPaymentType: 'paid', paymentProvider: 'mollie', appSalesEnabled: true,
  features: ['sunbeds', 'rentals'], partialGroupBookingEnabled: false, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  registry.extra = []
  registry.hide = []
  vi.mocked(auth).mockResolvedValue({ user: { id: OWNER } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as never)
  vi.mocked(prisma.site.findUnique).mockResolvedValue(siteRow() as never)
})

describe('inspect tool: scope and safety', () => {
  it('has no site/account parameter and rejects one the model supplies', async () => {
    const t = tools.find((x) => x.name === 'inspect')!
    expect(Object.keys(t.inputSchema.properties as object).sort()).toEqual(['aspect', 'topic'])
    const ex = await call({ aspect: 'features', siteId: 'someone-elses-site' })
    expect(ex.errors.length).toBeGreaterThan(0)
    expect(prisma.site.findUnique).toHaveBeenCalledTimes(0)
    expect(prisma.site.count).not.toHaveBeenCalled()
  })

  it('rejects an unknown aspect before any provider runs', async () => {
    const ex = await call({ aspect: 'secrets' })
    expect(ex.errors.length).toBeGreaterThan(0)
  })

  it('refuses a caller who does not own the site', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue(siteRow({ userId: 'intruder' }) as never)
    const ex = await call({ aspect: 'readiness' })
    expect(ex.result).toEqual({ ok: false, error: 'forbidden' })
    expect(prisma.partnerAccount.findUnique).not.toHaveBeenCalled()
  })

  it('every provider reads only the ctx site / account (never anything else)', async () => {
    vi.mocked(getEffectiveSubscriptionForUser).mockResolvedValue({ tier: 'PRO', name: 'Pro', monthlyPrice: 29, maxSites: 3, isCustom: false, features: { OFF_PLATFORM_BILLING: true } } as never)
    vi.mocked(getFlagStates).mockResolvedValue({ assistant: { name: 'assistant', enabled: true, source: 'account' }, devices: { name: 'devices', enabled: false, source: 'default' } } as never)
    vi.mocked(prisma.site.count).mockResolvedValue(1 as never)
    vi.mocked(prisma.siteWorkingHours.count).mockResolvedValue(2 as never)
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({ country: 'ES' } as never)
    vi.mocked(getSiteItemCounts).mockResolvedValue({ itemCount: 5, activeItemCount: 5, availableTodayCount: 5 })
    vi.mocked(loadSiteBase).mockResolvedValue({ ok: false, error: 'site_has_no_location' } as never)
    vi.mocked(getSiteFeeContext).mockResolvedValue(feeCtx() as never)
    for (const a of ['features', 'readiness', 'money', 'editor']) await inspect(a)
    for (const [arg] of vi.mocked(prisma.site.findUnique).mock.calls) expect((arg as any).where).toEqual({ id: SITE })
    for (const [arg] of vi.mocked(prisma.partnerAccount.findUnique).mock.calls) expect((arg as any).where).toEqual({ userId: OWNER })
    for (const [arg] of vi.mocked(prisma.site.count).mock.calls) expect((arg as any).where).toEqual({ userId: OWNER })
    expect(vi.mocked(getEffectiveSubscriptionForUser).mock.calls.every(([id]) => id === OWNER)).toBe(true)
    expect(vi.mocked(getFlagStates).mock.calls.every(([o]) => (o as any).accountId === OWNER)).toBe(true)
    expect(vi.mocked(getSiteFeeContext).mock.calls.every(([id]) => id === SITE)).toBe(true)
  })
})

describe('catalog', () => {
  it('lists every provider with summary + examples, and the tools that answer what', async () => {
    const r = await inspect('catalog')
    expect(r.aspects.map((a: any) => a.aspect)).toEqual([...INSPECT_ASPECTS])
    expect(INSPECT_ASPECTS).toEqual(['catalog', 'data', 'editor', 'space', 'features', 'readiness', 'money'])
    for (const a of r.aspects) {
      expect(a.summary.length).toBeGreaterThan(20)
      expect(a.examples.length).toBeGreaterThan(0)
    }
    const used = new Set(r.whereToLook.flatMap((g: any) => g.use))
    for (const t of ['sql', 'describe_site_area', 'measure', 'explain_feature']) expect(used.has(t)).toBe(true)
    expect(size(r)).toBeLessThanOrEqual(MAX_INSPECT_BYTES)
  })

  it('points at run_js only while it is registered, and never at a tool the model lacks', async () => {
    const run_js = defineTool({ name: 'run_js', label: 'Running code', description: 'x', run: () => ({}) })
    registry.hide = ['run_js'] // the real tool may or may not be registered; test both states explicitly
    const without = await inspect('catalog')
    expect(new Set(without.whereToLook.flatMap((g: any) => g.use)).has('run_js')).toBe(false)
    registry.extra = [run_js]
    const withIt = await inspect('catalog')
    expect(new Set(withIt.whereToLook.flatMap((g: any) => g.use)).has('run_js')).toBe(true)
    registry.extra = []
    registry.hide = ['sql']
    expect(new Set((await inspect('catalog')).whereToLook.flatMap((g: any) => g.use)).has('sql')).toBe(false)
  })

  it('the tool description names every aspect', () => {
    const t = tools.find((x) => x.name === 'inspect')!
    for (const p of INSPECT_PROVIDERS) expect(t.description).toContain(p.name)
  })
})

describe('data (ER model generated from snapshot/schema.ts)', () => {
  it('overview has every table and view; each table topic has exactly the allowlisted columns, none denied', async () => {
    const o = await inspect('data')
    const names = o.tables.map((t: any) => t.name)
    for (const t of SNAPSHOT_TABLES) expect(names).toContain(t.name)
    for (const v of SNAPSHOT_VIEWS) expect(names).toContain(v.name)
    for (const t of SNAPSHOT_TABLES) {
      const d = await inspect('data', t.name)
      expect(d.columns.map((c: any) => c.name)).toEqual(t.columns.map((c) => c.name))
      expect(d.columns.map((c: any) => c.type)).toEqual(t.columns.map((c) => c.type))
      for (const c of d.columns) expect(DENIED_COLUMN.test(c.name)).toBe(false)
      expect(size(d)).toBeLessThanOrEqual(MAX_INSPECT_BYTES)
    }
    expect(o.notes.join(' ')).toMatch(/No guest names/)
  })

  it('gives units for metres, degrees, money and percent', async () => {
    const col = async (t: string, c: string) => (await inspect('data', t)).columns.find((x: any) => x.name === c)
    expect((await col('parcel', 'gap_between_rows')).unit).toBe('metres')
    expect((await col('parcel', 'rotation')).unit).toBe('degrees')
    expect((await col('seat', 'price')).unit).toBe('EUR per day')
    expect((await col('site', 'vat')).unit).toBe('percent')
    expect((await col('seat', 'x')).unit).toBe('metres')
  })

  it('an unknown or non-allowlisted table is refused', async () => {
    for (const bad of ['user', 'partner_account', 'invoice_line', 'pg_catalog']) {
      expect((await inspect('data', bad)).error).toBe('unknown_topic')
    }
  })

  it('every relationship names real table.column pairs', () => {
    const cols = (t: string) => SNAPSHOT_TABLES.find((x) => x.name === t)?.columns.map((c) => c.name)
    for (const r of RELATIONSHIPS) {
      for (const end of [r.from, r.to]) {
        const [table, column] = end.split('.')
        expect(cols(table!), `${end} table`).toBeDefined()
        if (column) expect(cols(table!), `${end} column`).toContain(column)
      }
    }
  })

  it('every example SQL passes the sql tool gate and executes on the real snapshot schema', async () => {
    const empty = Object.fromEntries(SNAPSHOT_TABLES.map((t) => [t.name, []])) as never
    const db = await buildDatabase(empty, 'UTC')
    try {
      for (const r of RELATIONSHIPS) {
        const checked = checkSql(r.sql)
        expect(checked.ok, r.sql).toBe(true)
        if (checked.ok) {
          const res = await runReadOnly(db, checked.query)
          expect(res.ok, `${r.from} -> ${r.to}: ${JSON.stringify(res)}`).toBe(true)
        }
      }
    } finally {
      await db.close()
    }
  }, 60_000)

  it('covers every FK-like column of the snapshot with a relationship (a new *_id column fails until documented)', () => {
    const linked = new Set(RELATIONSHIPS.flatMap((r) => [r.from, r.to]))
    for (const t of SNAPSHOT_TABLES) {
      for (const c of t.columns) {
        if (c.name === 'id' || !/_id$/.test(c.name)) continue
        expect(linked.has(`${t.name}.${c.name}`), `${t.name}.${c.name} needs a RELATIONSHIPS entry`).toBe(true)
      }
    }
  })
})

describe('editor (generated from the registered propose tools)', () => {
  it('lists every registered propose tool and every metadata entry points at a real tool', async () => {
    const r = await inspect('editor')
    const listed = r.operations.map((o: any) => o.tool)
    const propose = tools.filter((t) => t.name.startsWith('propose_')).map((t) => t.name)
    expect(propose.length).toBeGreaterThan(15)
    for (const n of propose) expect(listed).toContain(n)
    for (const n of propose) expect(OP_META[n], `${n} needs an OP_META entry`).toBeDefined()
    const names = new Set(tools.map((t) => t.name))
    for (const k of Object.keys(OP_META)) expect(names.has(k), `OP_META.${k} is stale`).toBe(true)
    expect(size(r)).toBeLessThanOrEqual(MAX_INSPECT_BYTES)
  })

  it('auto-includes a newly registered propose tool, flagged undocumented until it gets metadata', async () => {
    const fake = defineTool({
      name: 'propose_fake_widget', label: 'Preparing a widget', description: 'Propose a fake widget. Second sentence.',
      properties: { size_m: { type: 'number', minimum: 1, maximum: 9 }, mode: { type: 'string', enum: ['a', 'b'] } }, required: ['size_m'], run: () => ({}),
    }) as AssistantTool
    registry.extra = [fake]
    const r = await inspect('editor')
    const op = r.operations.find((o: any) => o.tool === 'propose_fake_widget')
    expect(op).toMatchObject({ documented: false, params: ['size_m*', 'mode'] })
    const one = (await inspect('editor', 'propose_fake_widget')).operation
    expect(one.params).toEqual([
      { name: 'size_m', type: 'number 1..9', required: true, unit: 'metres' },
      { name: 'mode', type: '"a"|"b"', required: false },
    ])
    // The pure generator behaves the same.
    expect(describeEditor([...tools, fake], 'geo').operations.map((o: any) => o.tool)).toContain('propose_fake_widget')
  })

  it('exposes types, ranges and units from the JSON schema', async () => {
    const canvas = (await inspect('editor', 'propose_canvas_size')).operation
    expect(canvas.params).toEqual([
      { name: 'width_m', type: 'number 5..500', required: true, unit: 'metres' },
      { name: 'height_m', type: 'number 5..500', required: true, unit: 'metres' },
    ])
    const parcel = (await inspect('editor', 'propose_edit_parcel')).operation
    expect(parcel.params.find((p: any) => p.name === 'rows').type).toBe('integer 1..100')
    expect(parcel.params.find((p: any) => p.name === 'horizontal_gap_m').unit).toBe('metres')
    expect(parcel.qrReprint).toBe('maybe')
    expect(parcel.undoable).toBe('yes')
  })

  it('accepts an operation topic without its tool prefix (the model asked for "edit_parcel" live)', async () => {
    expect((await inspect('editor', 'edit_parcel')).operation.tool).toBe('propose_edit_parcel')
    expect((await inspect('editor', 'Edit_Parcel')).operation.tool).toBe('propose_edit_parcel')
  })

  it('carries undo / QR / precondition metadata that matches the handlers', async () => {
    const del = (await inspect('editor', 'propose_delete')).operation
    expect(del.undoable).toBe('no')
    expect(del.needs.join(' ')).toMatch(/device/)
    expect((await inspect('editor', 'propose_reverse')).operation.qrReprint).toBe('maybe')
    expect((await inspect('editor', 'propose_layout_elements')).operation.modes).toEqual(['schematic'])
    expect((await inspect('editor', 'propose_move')).operation.manualPath).toMatch(/drag/i)
  })

  it('marks operations unavailable on this site layout mode', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue(siteRow({ layoutMode: 'schematic' }) as never)
    const r = await inspect('editor')
    expect(r.layoutMode).toBe('schematic')
    expect(r.operations.find((o: any) => o.tool === 'propose_layout_from_photo').availableOnThisSite).toBe(false)
    expect(r.operations.find((o: any) => o.tool === 'propose_canvas_size').availableOnThisSite).toBeUndefined()
  })

  it('areas group operations; an unknown topic is refused', async () => {
    const inv = await inspect('editor', 'inventory')
    expect(inv.operations.map((o: any) => o.tool)).toContain('propose_rotate')
    expect(inv.operations.map((o: any) => o.tool)).not.toContain('propose_site_fields')
    expect((await inspect('editor', 'nope')).error).toBe('unknown_topic')
  })

  it('the explain_feature topics the metadata cites exist', () => {
    const known = new Set(knowledgeTopicIds())
    for (const id of referencedKnowledgeTopics()) expect(known.has(id), id).toBe(true)
  })
})

describe('space', () => {
  it('states the frame conventions and points at the spatial tools', async () => {
    vi.mocked(loadSiteBase).mockResolvedValue({ ok: true, mode: 'geo', origin: { lat: 1, lng: 2 }, parcels: [{}, {}], parcelsWithoutGeometry: [3] } as never)
    const r = await inspect('space')
    expect(r.frame.x).toMatch(/EAST/)
    expect(r.frame.y).toMatch(/NORTH/)
    expect(r.frame.bearings).toMatch(/clockwise from north/)
    expect(r.site).toEqual({ layoutMode: 'geo', parcelsWithGeometry: 2, parcelsWithoutGeometry: 1, hasMapOrigin: true })
    expect(JSON.stringify(r)).toMatch(/describe_site_area/)
    expect(JSON.stringify(r)).toMatch(/measure/)
  })

  it('topic sea returns the bearing (with compass point) when a shoreline exists', async () => {
    vi.mocked(loadSiteBase).mockResolvedValue({ ok: true, mode: 'geo', origin: { lat: 1, lng: 2 }, parcels: [], parcelsWithoutGeometry: [] } as never)
    vi.mocked(loadSeaModel).mockResolvedValue({ ok: true, source: 'OpenStreetMap coastline', model: { bearing: () => 250.04, distance: () => 31.26 } } as never)
    const r = await inspect('space', 'sea')
    expect(r).toMatchObject({ available: true, seaBearingDegrees: 250, seaDirection: 'WSW', distanceFromSiteCentreToWaterM: 31.3, source: 'OpenStreetMap coastline' })
    expect(vi.mocked(loadSeaModel).mock.calls[0]![0]).toBe(SITE)
  })

  it('topic sea explains when there is no shoreline', async () => {
    vi.mocked(loadSiteBase).mockResolvedValue({ ok: true, mode: 'schematic', origin: null, parcels: [], parcelsWithoutGeometry: [] } as never)
    vi.mocked(loadSeaModel).mockResolvedValue({ ok: false, reason: 'no_water_in_the_schematic' })
    const r = await inspect('space', 'sea')
    expect(r).toMatchObject({ available: false, reason: 'no_water_in_the_schematic' })
    expect(r.next).toMatch(/Water element/)
  })
})

describe('features', () => {
  const sub = (tier: string, over: Record<string, unknown> = {}) => ({
    tier, name: tier === 'STARTER' ? 'Starter' : 'Pro', monthlyPrice: tier === 'STARTER' ? 0 : 29, maxSites: tier === 'STARTER' ? 1 : 3, isCustom: false,
    features: { OFF_PLATFORM_BILLING: tier !== 'STARTER' }, ...over,
  })
  beforeEach(() => {
    vi.mocked(prisma.site.count).mockResolvedValue(1 as never)
    vi.mocked(getFlagStates).mockResolvedValue({ assistant: { name: 'assistant', enabled: true, source: 'account' }, devices: { name: 'devices', enabled: false, source: 'default' } } as never)
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({ status: 'ACTIVE', currentPeriodEnd: new Date('2026-11-01T00:00:00Z'), stripeSubscriptionId: 'sub_SECRET', stripeCustomerId: 'cus_SECRET' } as never)
  })

  it('explains what a Starter plan locks and which plan unlocks it', async () => {
    vi.mocked(getEffectiveSubscriptionForUser).mockResolvedValue(sub('STARTER') as never)
    const r = await inspect('features')
    expect(r.plan).toMatchObject({ tier: 'STARTER', maxSites: 1, sitesUsed: 1, canAddSite: false, commissionPercent: 6, subscriptionStatus: 'ACTIVE', currentPeriodEnd: '2026-11-01' })
    expect(r.entitlements[0]).toMatchObject({ key: 'OFF_PLATFORM_BILLING', enabled: false, unlockedBy: ['Pro', 'Business', 'or an admin override'] })
    expect(r.entitlements[0].whyLocked).toMatch(/Starter/)
    expect(r.ladder.map((l: any) => l.tier)).toEqual(['STARTER', 'PRO', 'BUSINESS'])
    expect(JSON.stringify(r)).not.toMatch(/SECRET/)
  })

  it('a Pro plan has it unlocked, with flags (state + source) and site features', async () => {
    vi.mocked(getEffectiveSubscriptionForUser).mockResolvedValue(sub('PRO') as never)
    const r = await inspect('features')
    expect(r.entitlements[0]).toEqual(expect.objectContaining({ enabled: true }))
    expect(r.entitlements[0].whyLocked).toBeUndefined()
    expect(r.plan.canAddSite).toBe(true)
    expect(r.flags).toEqual([
      { name: 'assistant', enabled: true, source: 'account', about: 'Partner AI assistant.' },
      { name: 'devices', enabled: false, source: 'default', about: 'Sunbed indicator devices.' },
    ])
    expect(r.site).toMatchObject({ layoutMode: 'geo', billing: 'integrated payments', features: [{ feature: 'sunbeds' }, { feature: 'rentals' }] })
  })
})

describe('readiness', () => {
  const account = (over: Record<string, unknown> = {}) => ({
    country: 'ES', paymentProvider: 'mollie', mollieAccessToken: 'access_SECRET_TOKEN', mollieOnboardingStatus: 'needs-data', ...over,
  })
  beforeEach(() => {
    vi.mocked(getSiteItemCounts).mockResolvedValue({ itemCount: 10, activeItemCount: 8, availableTodayCount: 8 })
    vi.mocked(prisma.siteWorkingHours.count).mockResolvedValue(3 as never)
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue(account() as never)
  })

  it('reports the missing items, the blocking payment state and never leaks the token', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue(siteRow({ image: null }) as never)
    const r = await inspect('readiness')
    expect(r.readyToGoLive).toBe(false)
    expect(r.missing).toEqual(['Cover photo (Content tab)', 'Payment provider connected and ready (/account/mollie)'])
    expect(r.payments).toMatchObject({ selected: 'Mollie', effective: 'Mollie', ready: false, status: 'needs_data', nextStep: 'complete_onboarding' })
    expect(r.blocksBookings.join(' ')).toMatch(/payment is not ready/i)
    expect(JSON.stringify(r)).not.toMatch(/SECRET/)
  })

  it('is ready when everything is met and the provider is ready', async () => {
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue(account({ mollieOnboardingStatus: 'completed' }) as never)
    const r = await inspect('readiness')
    expect(r).toMatchObject({ readyToGoLive: true, missing: [], blocksBookings: [] })
  })

  it('an unpaid (off-platform) site does not ask for price, VAT or payments', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue(siteRow({ type: 'unpaid', price: null, vat: null, orderPaymentType: 'unpaid', rentalPaymentType: 'unpaid' }) as never)
    const keys = (await inspect('readiness')).checklist.map((i: any) => i.key)
    expect(keys).toEqual(['name', 'location', 'working-hours', 'inventory', 'image'])
  })

  it('selected vs effective provider: a not-yet-ready selection keeps the previous working one', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue(siteRow({ paymentProvider: 'mollie' }) as never)
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue(account({ paymentProvider: 'stripe', stripeConnectAccountId: 'acct_x', stripeConnectChargesEnabled: false, mollieOnboardingStatus: 'completed' }) as never)
    const p = (await inspect('readiness')).payments
    expect(p).toMatchObject({ selected: 'Stripe', effective: 'Mollie', selectedIsEffective: false, ready: true })
    expect(p.why).toMatch(/previous working one/)
  })

  it('flags the hidden site / no sunbeds / no hours as blockers', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue(siteRow({ status: 'hidden' }) as never)
    vi.mocked(getSiteItemCounts).mockResolvedValue({ itemCount: 0, activeItemCount: 0, availableTodayCount: 0 })
    vi.mocked(prisma.siteWorkingHours.count).mockResolvedValue(0 as never)
    const b = (await inspect('readiness')).blocksBookings.join(' | ')
    expect(b).toMatch(/hidden/)
    expect(b).toMatch(/No active sunbeds/)
    expect(b).toMatch(/working hours/)
  })
})

describe('money', () => {
  it('resolves the cascade, with the account override beating the platform fee', async () => {
    vi.mocked(getSiteFeeContext).mockResolvedValue(feeCtx({ accountFees: [fee('sunbed-rental', 5)] }) as never)
    const r = await inspect('money')
    expect(r.services.find((s: any) => s.service === 'sunbed-rental')).toMatchObject({ source: 'account override', fee: '5% of the total', chargedNow: '5% of the total' })
    expect(r.services.find((s: any) => s.service === 'food-and-beverage')).toMatchObject({ source: 'platform fee for the PRO plan', fee: '3% of the total' })
    expect(r.example).toMatchObject({
      guestPays: 20,
      partnerInvoice: { gross: 20, net: 16.53, vat: 3.47 },
      commission: { gross: 1, rule: 'percentage of the total, once' },
      takenAsApplicationFee: 1,
      partnerKeeps: 19,
    })
  })

  it('a site override beats the account override; the platform default applies without a plan fee', async () => {
    vi.mocked(getSiteFeeContext).mockResolvedValue(feeCtx({ siteFees: [fee('sunbed-rental', 2)], accountFees: [fee('sunbed-rental', 5)], tier: null }) as never)
    const r = await inspect('money')
    expect(r.services[0]).toMatchObject({ source: 'site override', fee: '2% of the total' })
    expect(r.services[1]).toMatchObject({ source: 'platform default', fee: '6% of the total' })
  })

  it('a fixed fee is charged per bed', async () => {
    vi.mocked(getSiteFeeContext).mockResolvedValue(feeCtx({ accountFees: [{ ...fee('sunbed-rental', 0), chargeType: 'fixed', feeAmount: 0.5, percentage: null }] }) as never)
    const r = await inspect('money')
    expect(r.services[0].fee).toBe('0.5 EUR fixed per bed')
    expect(r.example.commission).toMatchObject({ gross: 1, rule: 'fixed fee x number of beds' })
  })

  it('the launch offer waives the charged commission', async () => {
    const promotions = [{ code: LAUNCH_PROMOTION.code, startedAt: null, endsAt: null, revokedAt: null }]
    vi.mocked(getSiteFeeContext).mockResolvedValue(feeCtx({ promotions }) as never)
    const r = await inspect('money')
    expect(r.services[0].chargedNow).toBe('waived (launch offer)')
    expect(r.launchOffer).toMatch(/waived/)
    expect(r.example.commission.gross).toBe(0)
    expect(r.example.partnerKeeps).toBe(20)
  })

  it('Stripe adds the card-processing pass-through to the application fee', async () => {
    vi.mocked(getSiteFeeContext).mockResolvedValue(feeCtx({ provider: 'stripe' }) as never)
    const r = await inspect('money')
    // 20 EUR: 3% tier commission 0.60 + (1.5% of 20 + 0.25) = 0.55 pass-through.
    expect(r.example).toMatchObject({ cardProcessingPassThrough: 0.55, takenAsApplicationFee: 1.15, partnerKeeps: 18.85 })
  })

  it('cross-border B2B commission is reverse-charged (0 VAT)', async () => {
    vi.mocked(getSiteFeeContext).mockResolvedValue(feeCtx({ partnerCountry: 'FI', businessId: 'FI123' }) as never)
    const r = await inspect('money')
    expect(r.vat.commissionReverseCharge).toMatch(/0 VAT/)
    expect(r.example.commission.vat).toBe(0)
  })

  it('never returns the account row (tokens, bank account) the fee context carries', async () => {
    vi.mocked(getSiteFeeContext).mockResolvedValue(feeCtx() as never)
    expect(JSON.stringify(await inspect('money'))).not.toMatch(/SECRET|ES91|mollie_/)
  })
})

describe('output size caps', () => {
  it('fitToBudget halves the longest list, says so, and stays under the cap', () => {
    const big = { ok: true, rows: Array.from({ length: 2000 }, (_, i) => ({ i, text: 'x'.repeat(40) })), small: [1, 2, 3] }
    const out = fitToBudget(big, 8000) as any
    expect(size(out)).toBeLessThanOrEqual(8000)
    expect(out.rows.length).toBeLessThan(2000)
    expect(out._truncated.join(' ')).toMatch(/rows: showing \d+ of 2000/)
    expect(out.small).toEqual([1, 2, 3])
    expect(fitToBudget({ a: 1 }, 8000)).toEqual({ a: 1 })
  })

  it('clips runaway strings as a last resort', () => {
    const out = fitToBudget({ blob: 'y'.repeat(50_000) }, 8000) as any
    expect(size(out)).toBeLessThanOrEqual(8000)
    expect(out._truncated).toContain('long text clipped')
  })

  it('the tool trims an oversized provider result through the same budget', async () => {
    // Enough operations to blow the editor overview past the cap.
    registry.extra = Array.from({ length: 120 }, (_, i) =>
      defineTool({ name: `propose_bulk_${i}`, label: 'Preparing bulk', description: `Propose bulk change ${i}. ${'detail '.repeat(30)}`, properties: { a: { type: 'string' } }, run: () => ({}) }),
    )
    const r = await inspect('editor')
    expect(size(r)).toBeLessThanOrEqual(MAX_INSPECT_BYTES)
    expect(r._truncated.join(' ')).toMatch(/operations: showing/)
  })

  it('every aspect stays within the cap with realistic data', async () => {
    vi.mocked(getEffectiveSubscriptionForUser).mockResolvedValue({ tier: 'PRO', name: 'Pro', monthlyPrice: 29, maxSites: 3, isCustom: false, features: { OFF_PLATFORM_BILLING: true } } as never)
    vi.mocked(getFlagStates).mockResolvedValue({} as never)
    vi.mocked(prisma.site.count).mockResolvedValue(1 as never)
    vi.mocked(prisma.siteWorkingHours.count).mockResolvedValue(3 as never)
    vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue({ country: 'ES' } as never)
    vi.mocked(getSiteItemCounts).mockResolvedValue({ itemCount: 5, activeItemCount: 5, availableTodayCount: 5 })
    vi.mocked(loadSiteBase).mockResolvedValue({ ok: true, mode: 'geo', origin: { lat: 1, lng: 2 }, parcels: [], parcelsWithoutGeometry: [] } as never)
    vi.mocked(getSiteFeeContext).mockResolvedValue(feeCtx() as never)
    for (const a of INSPECT_ASPECTS) {
      const r = await inspect(a)
      expect(size(r), a).toBeLessThanOrEqual(MAX_INSPECT_BYTES)
      expect(r._truncated, `${a} should not need trimming`).toBeUndefined()
    }
  })
})

afterAll(() => {
  registry.extra = []
})

// ─── fixtures ───────────────────────────────────────────────────────────────

function fee(serviceCode: string, percentage: number, over: Record<string, unknown> = {}) {
  return { id: `f-${serviceCode}-${percentage}`, serviceCode, chargeType: 'percentage', percentage, feeAmount: null, subscriptionTier: null, ...over }
}

function feeCtx(o: { siteFees?: any[]; accountFees?: any[]; tier?: string | null; promotions?: any[]; provider?: string; partnerCountry?: string; businessId?: string | null } = {}) {
  const tier = o.tier === undefined ? 'PRO' : o.tier
  const settingsFees = ['sunbed-rental', 'food-and-beverage', 'equipment-rental'].flatMap((code) => [
    fee(code, 6),
    fee(code, 3, { subscriptionTier: 'PRO' }),
  ])
  return {
    site: { id: SITE, vat: 21, rentalVat: 10, price: 10, paymentProvider: o.provider ?? 'mollie', serviceFees: o.siteFees ?? [] },
    partnerAccount: {
      userId: OWNER, country: o.partnerCountry ?? 'ES', businessId: o.businessId ?? 'ESB123', bankAccount: 'ES9121000418450200051332', mollieAccessToken: 'mollie_SECRET',
      serviceFees: o.accountFees ?? [], promotions: o.promotions ?? [],
    },
    settings: { country: 'ES', vat: 21, serviceFees: settingsFees },
    tier,
    features: {},
  }
}
