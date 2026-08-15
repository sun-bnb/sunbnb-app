/**
 * Regression tests for getSite ownership guard.
 *
 * Bug fixed: getSite previously had no auth check, exposing full site data
 * (including reservations.user.email) to any caller with a siteId.
 *
 * Fix: ownership enforced query-side via:
 *   where: { id: siteId, userId: session.user.id }
 *   (queries.ts — mirrors the getBrand pattern in site-actions.ts)
 *
 * These tests are the regression guard. getSite is on the UNGATED_ALLOWLIST
 * (not the gated-actions registry) because it returns data|null rather than
 * { status } and enforces ownership at the query layer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('@repo/data/payment', () => ({
  resolveSiteFees: vi.fn().mockResolvedValue([]),
}))

import { getSite, getInventoryItems, getItemsByGroups } from './queries'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

const mockAuth = vi.mocked(auth)
const OWNER_ID = 'owner-1'
const OTHER_USER_ID = 'other-user-2'
const SITE_ID = 'site-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null)
})

// ─── unauthenticated caller ──────────────────────────────────────────────────

describe('getSite — unauthenticated caller', () => {
  it('returns null without querying the DB', async () => {
    // no session set — mockAuth returns null
    const result = await getSite(SITE_ID)

    expect(result).toBeNull()
    // must not reach Prisma at all
    expect(vi.mocked(prisma.site.findFirst)).not.toHaveBeenCalled()
  })
})

// ─── non-owner caller ────────────────────────────────────────────────────────

describe('getSite — non-owner caller', () => {
  it('returns null when the site does not belong to the session user', async () => {
    // Authenticated as OTHER_USER_ID (not the site owner)
    mockAuth.mockResolvedValue({ user: { id: OTHER_USER_ID } } as any)

    // Prisma returns null because the where-clause filters userId !== OTHER_USER_ID
    vi.mocked(prisma.site.findFirst).mockResolvedValue(null)

    const result = await getSite(SITE_ID)

    expect(result).toBeNull()

    // Confirm the ownership filter was passed to Prisma
    const call = vi.mocked(prisma.site.findFirst).mock.calls[0]![0]
    expect((call.where as any).userId).toBe(OTHER_USER_ID)
    expect((call.where as any).id).toBe(SITE_ID)
  })
})

// ─── owner caller ────────────────────────────────────────────────────────────

describe('getSite — owner caller', () => {
  it('returns site data when the session user owns the site', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)

    const fakeSite = {
      id: SITE_ID,
      userId: OWNER_ID,
      workingHours: [],
      inventoryItems: [],
      layoutElements: [],
      products: [],
    }
    vi.mocked(prisma.site.findFirst).mockResolvedValue(fakeSite as any)

    const result = await getSite(SITE_ID)

    expect(result).toMatchObject({ id: SITE_ID, userId: OWNER_ID })

    // Ownership filter is still in place — not bypassed for owner
    const call = vi.mocked(prisma.site.findFirst).mock.calls[0]![0]
    expect((call.where as any).userId).toBe(OWNER_ID)
  })
})

// ─── getInventoryItems (scoped refresh, track 020) ───────────────────────────

describe('getInventoryItems', () => {
  it('returns null without querying items when unauthenticated', async () => {
    const result = await getInventoryItems(SITE_ID, ['i1'])
    expect(result).toBeNull()
    expect(vi.mocked(prisma.inventoryItem.findMany)).not.toHaveBeenCalled()
  })

  it('returns null for a non-owner (ownership filter) without querying items', async () => {
    mockAuth.mockResolvedValue({ user: { id: OTHER_USER_ID } } as any)
    vi.mocked(prisma.site.findFirst).mockResolvedValue(null)

    const result = await getInventoryItems(SITE_ID, ['i1'])
    expect(result).toBeNull()
    expect(vi.mocked(prisma.site.findFirst)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SITE_ID, userId: OTHER_USER_ID } })
    )
    expect(vi.mocked(prisma.inventoryItem.findMany)).not.toHaveBeenCalled()
  })

  it('empty id list short-circuits to [] with no item query', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findFirst).mockResolvedValue({ id: SITE_ID } as any)

    const result = await getInventoryItems(SITE_ID, [])
    expect(result).toEqual([])
    expect(vi.mocked(prisma.inventoryItem.findMany)).not.toHaveBeenCalled()
  })

  it('fetches ONLY the requested ids, site-scoped', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findFirst).mockResolvedValue({ id: SITE_ID } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([{ id: 'i1' }] as any)

    const result = await getInventoryItems(SITE_ID, ['i1', 'i2'])
    expect(result).toEqual([{ id: 'i1' }])

    const arg = vi.mocked(prisma.inventoryItem.findMany).mock.calls[0]![0]! as any
    expect(arg.where).toEqual({ id: { in: ['i1', 'i2'] }, siteId: SITE_ID })
  })

  // The client MERGES these rows into the site context by id, so the scoped
  // refresh must project EXACTLY what the full-site load projects — drift
  // silently blanks fields on whatever the user just edited (track 020 C2).
  it('projects the same per-item shape as getSite (merge-compatibility contract)', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findFirst).mockResolvedValue({ id: SITE_ID } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as any)

    await getInventoryItems(SITE_ID, ['i1'])
    const scoped = (vi.mocked(prisma.inventoryItem.findMany).mock.calls[0]![0]! as any).select

    await getSite(SITE_ID)
    const full = (vi.mocked(prisma.site.findFirst).mock.calls.at(-1)![0]! as any)
      .include.inventoryItems.select

    expect(scoped).toEqual(full)
    // And the projection is genuinely narrow: no heavy/unread columns, and
    // pair/pairedBy are id stubs rather than whole rows.
    expect(scoped.notes).toBeUndefined()
    expect(scoped.image).toBeUndefined()
    expect(scoped.createdAt).toBeUndefined()
    expect(scoped.pair).toEqual({ select: { id: true } })
    expect(scoped.pairedBy).toEqual({ select: { id: true } })
    // Fields the editors DO read must be present.
    for (const f of ['id', 'number', 'seatLabel', 'locationLat', 'locationLng',
                     'schematicX', 'schematicY', 'rotation', 'status', 'group',
                     'itemGroupId', 'sunbedGroupId', 'pairId']) {
      expect(scoped[f], `missing projected field: ${f}`).toBe(true)
    }
  })
})

// ─── getItemsByGroups (parcel-tier streaming, track 020 C2 slice 2) ──────────

describe('getItemsByGroups', () => {
  it('returns null when unauthenticated, without touching items', async () => {
    expect(await getItemsByGroups(SITE_ID, [1])).toBeNull()
    expect(vi.mocked(prisma.inventoryItem.findMany)).not.toHaveBeenCalled()
  })

  it('returns null for a non-owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: OTHER_USER_ID } } as any)
    vi.mocked(prisma.site.findFirst).mockResolvedValue(null)
    expect(await getItemsByGroups(SITE_ID, [1])).toBeNull()
    expect(vi.mocked(prisma.inventoryItem.findMany)).not.toHaveBeenCalled()
  })

  it('empty group list short-circuits', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findFirst).mockResolvedValue({ id: SITE_ID } as any)
    expect(await getItemsByGroups(SITE_ID, [])).toEqual([])
    expect(vi.mocked(prisma.inventoryItem.findMany)).not.toHaveBeenCalled()
  })

  it('queries the requested parcels site-scoped, ordered, with the shared projection', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.site.findFirst).mockResolvedValue({ id: SITE_ID } as any)
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as any)

    await getItemsByGroups(SITE_ID, [2, 5])
    const arg = vi.mocked(prisma.inventoryItem.findMany).mock.calls[0]![0]! as any
    expect(arg.where).toEqual({ siteId: SITE_ID, group: { in: [2, 5] } })
    // Ordering matters: seat order drives numbering/pair display in the editor.
    expect(arg.orderBy).toEqual({ number: 'asc' })
    // Same merge-compatible projection as the other two readers.
    expect(arg.select.pair).toEqual({ select: { id: true } })
    expect(arg.select.notes).toBeUndefined()
  })
})
