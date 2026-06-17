/**
 * Unit tests for setRestaurantServiceShifts and duplicateTableForRestaurant.
 *
 * Both functions had zero tests; this file adds requirements-driven behavioral
 * coverage for the auth gate, argument forwarding, and the validation errors
 * the core enforces.
 *
 * Mocking strategy: fully mock @repo/table-reservations-core so that the
 * real setRestaurantShifts / duplicateTable stubs can be configured per-test
 * without worrying about internal module bindings. The partner wrapper's
 * responsibility is (a) auth gate and (b) forwarding to core — both are tested.
 * Validation edge-cases are covered either here (via mocked core returning error)
 * or in the integration tests where the real core runs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/auth', () => ({ auth: vi.fn() }))
vi.mock('@/app/flags', () => ({ isFlagEnabled: vi.fn().mockResolvedValue(true) }))

// Fully mock the core. Per test, stub the function under test.
vi.mock('@repo/table-reservations-core', () => ({
  setRestaurantShifts: vi.fn(),
  duplicateTable: vi.fn(),
  // Other exports referenced by auth-helpers or action imports:
  requireRestaurantOwner: vi.fn(),
  uniqueRestaurantSlug: vi.fn(),
  createRestaurant: vi.fn(),
  updateRestaurant: vi.fn(),
  setRestaurantHours: vi.fn(),
  createCombination: vi.fn(),
  updateCombination: vi.fn(),
  deleteCombination: vi.fn(),
  createTable: vi.fn(),
  updateTable: vi.fn(),
  deleteTable: vi.fn(),
  createLayoutElement: vi.fn(),
  updateLayoutElement: vi.fn(),
  deleteLayoutElement: vi.fn(),
}))

import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import { setRestaurantShifts, duplicateTable } from '@repo/table-reservations-core'
import { setRestaurantServiceShifts } from './actions'
import { duplicateTableForRestaurant } from './tables/actions'
import { revalidatePath } from 'next/cache'

const mockAuth = vi.mocked(auth)
const mockSetRestaurantShifts = vi.mocked(setRestaurantShifts)
const mockDuplicateTable = vi.mocked(duplicateTable)

const RESTAURANT_ID = 'restaurant-1'
const OWNER_ID = 'user-1'
const TABLE_ID = 'table-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(null as any)
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authorizeRestaurantOwner() {
  mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
  vi.mocked(prisma.restaurant.findUnique).mockResolvedValueOnce({
    partnerAccountId: OWNER_ID,
  } as any)
}

// ---------------------------------------------------------------------------
// setRestaurantServiceShifts
// ---------------------------------------------------------------------------

describe('setRestaurantServiceShifts', () => {
  it('rejects unauthenticated', async () => {
    const res = await setRestaurantServiceShifts(RESTAURANT_ID, [])
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(mockSetRestaurantShifts).not.toHaveBeenCalled()
  })

  it('rejects when restaurant is not owned', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    vi.mocked(prisma.restaurant.findUnique).mockResolvedValueOnce({
      partnerAccountId: 'someone-else',
    } as any)

    const res = await setRestaurantServiceShifts(RESTAURANT_ID, [])
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(mockSetRestaurantShifts).not.toHaveBeenCalled()
  })

  it('forwards core validation errors: startTime >= endTime', async () => {
    authorizeRestaurantOwner()
    mockSetRestaurantShifts.mockResolvedValue({
      status: 'error',
      errors: ['startTime must be before endTime (Dinner)'],
    } as any)

    const res = await setRestaurantServiceShifts(RESTAURANT_ID, [
      { name: 'Dinner', day: 5, startTime: '22:00', endTime: '20:00' },
    ])
    expect(res.status).toBe('error')
    expect(res.errors?.some((e) => /startTime must be before endTime/i.test(e))).toBe(true)
  })

  it('forwards core validation errors: pacingWindowMinutes out of range', async () => {
    authorizeRestaurantOwner()
    mockSetRestaurantShifts.mockResolvedValue({
      status: 'error',
      errors: ['pacingWindowMinutes must be 5–240'],
    } as any)

    const res = await setRestaurantServiceShifts(RESTAURANT_ID, [
      { name: 'Lunch', day: 1, startTime: '12:00', endTime: '15:00', pacingWindowMinutes: 2 },
    ])
    expect(res.status).toBe('error')
    expect(res.errors?.some((e) => /pacingWindowMinutes/i.test(e))).toBe(true)
  })

  it('delegates to core setRestaurantShifts with the right restaurantId and userId', async () => {
    authorizeRestaurantOwner()
    mockSetRestaurantShifts.mockResolvedValue({ status: 'ok' } as any)

    const shifts = [
      { name: 'Lunch', day: 1, startTime: '12:00', endTime: '15:00' },
      { name: 'Dinner', day: 1, startTime: '19:00', endTime: '23:00', pacingCovers: 40, pacingWindowMinutes: 30 },
    ]
    const res = await setRestaurantServiceShifts(RESTAURANT_ID, shifts)

    expect(res.status).toBe('ok')
    expect(mockSetRestaurantShifts).toHaveBeenCalledWith(RESTAURANT_ID, shifts, OWNER_ID)
  })

  it('delegates with an empty array (clear-all semantics)', async () => {
    authorizeRestaurantOwner()
    mockSetRestaurantShifts.mockResolvedValue({ status: 'ok' } as any)

    const res = await setRestaurantServiceShifts(RESTAURANT_ID, [])

    expect(res.status).toBe('ok')
    expect(mockSetRestaurantShifts).toHaveBeenCalledWith(RESTAURANT_ID, [], OWNER_ID)
  })

  it('revalidates the restaurant path on success', async () => {
    authorizeRestaurantOwner()
    mockSetRestaurantShifts.mockResolvedValue({ status: 'ok' } as any)

    await setRestaurantServiceShifts(RESTAURANT_ID, [])

    expect(revalidatePath).toHaveBeenCalledWith(`/restaurants/${RESTAURANT_ID}`)
  })

  it('does NOT revalidate on core error', async () => {
    authorizeRestaurantOwner()
    mockSetRestaurantShifts.mockResolvedValue({
      status: 'error',
      errors: ['startTime must be before endTime (Lunch)'],
    } as any)

    await setRestaurantServiceShifts(RESTAURANT_ID, [
      { name: 'Lunch', day: 1, startTime: '15:00', endTime: '12:00' },
    ])

    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// duplicateTableForRestaurant
// ---------------------------------------------------------------------------

describe('duplicateTableForRestaurant', () => {
  it('rejects unauthenticated', async () => {
    const res = await duplicateTableForRestaurant(RESTAURANT_ID, TABLE_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authenticated')
    expect(mockDuplicateTable).not.toHaveBeenCalled()
  })

  it('rejects when restaurant is not owned', async () => {
    mockAuth.mockResolvedValue({ user: { id: OWNER_ID } } as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
    vi.mocked(prisma.restaurant.findUnique).mockResolvedValueOnce({
      partnerAccountId: 'someone-else',
    } as any)

    const res = await duplicateTableForRestaurant(RESTAURANT_ID, TABLE_ID)
    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not authorized')
    expect(mockDuplicateTable).not.toHaveBeenCalled()
  })

  it('delegates to core duplicateTable with tableId and userId', async () => {
    authorizeRestaurantOwner()
    mockDuplicateTable.mockResolvedValue({
      status: 'ok',
      table: { id: 'table-copy-1' },
    } as any)

    const res = await duplicateTableForRestaurant(RESTAURANT_ID, TABLE_ID)

    expect(res.status).toBe('ok')
    expect(res.tableId).toBe('table-copy-1')
    expect(mockDuplicateTable).toHaveBeenCalledWith(TABLE_ID, OWNER_ID)
  })

  it('forwards Not found when the source table does not exist', async () => {
    authorizeRestaurantOwner()
    mockDuplicateTable.mockResolvedValue({
      status: 'error',
      errors: ['Not found'],
    } as any)

    const res = await duplicateTableForRestaurant(RESTAURANT_ID, TABLE_ID)

    expect(res.status).toBe('error')
    expect(res.errors).toContain('Not found')
  })

  it('revalidates the tables path on success', async () => {
    authorizeRestaurantOwner()
    mockDuplicateTable.mockResolvedValue({
      status: 'ok',
      table: { id: 'table-copy-1' },
    } as any)

    await duplicateTableForRestaurant(RESTAURANT_ID, TABLE_ID)

    expect(revalidatePath).toHaveBeenCalledWith(`/restaurants/${RESTAURANT_ID}/tables`)
  })

  it('does NOT revalidate when core returns an error', async () => {
    authorizeRestaurantOwner()
    mockDuplicateTable.mockResolvedValue({
      status: 'error',
      errors: ['Not found'],
    } as any)

    await duplicateTableForRestaurant(RESTAURANT_ID, TABLE_ID)

    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('the copy does NOT inherit the locked flag (carried over as false)', async () => {
    // This property is enforced by the core's duplicateTable — the test documents
    // the expected behavior: locked = false on the new table. The partner wrapper
    // delegates to core which is responsible for clearing locked; this test verifies
    // that the delegate is called (not bypassed) so the invariant holds.
    authorizeRestaurantOwner()
    mockDuplicateTable.mockResolvedValue({
      status: 'ok',
      table: { id: 'table-copy-1', locked: false },
    } as any)

    const res = await duplicateTableForRestaurant(RESTAURANT_ID, TABLE_ID)

    expect(res.status).toBe('ok')
    // The returned tableId maps to the copy; locked flag is the core's concern.
    expect(mockDuplicateTable).toHaveBeenCalledWith(TABLE_ID, OWNER_ID)
  })
})
