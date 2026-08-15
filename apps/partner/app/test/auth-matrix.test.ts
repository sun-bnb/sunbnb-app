/**
 * Auth-matrix test — Phase 0.2 / Phase 3 of the partner test-architecture track.
 *
 * For every entry in GATED_ACTIONS, emits the full scenario matrix for that
 * entry's gate type. Expected reds (genuine bugs, do NOT fix source):
 *   - queries.getSite: has no ownership check → unauthenticated/non-owner scenarios pass
 *
 * Phase 3 note: the former verifySiteOwnership vs verifySiteAccess divergence is
 * resolved — manage/actions.ts now delegates to the canonical verifySiteAccess
 * in lib/auth-helpers.ts. Both gates are unified on hasSome ['all', 'manage_site'].
 * Unit-mode mocks return null for wrongScope so both sets of actions reject equally.
 *
 * Architecture note: vi.mock() is hoisted, so these run before imports.
 * The matrix runner (auth-matrix.ts) and token-fixtures.ts use vi.mocked()
 * on the already-mocked modules — this works because all three files are
 * loaded in the same vitest module environment.
 */

import { describe, beforeEach, vi } from 'vitest'

// ─── Global mocks (hoisted) ───────────────────────────────────────────────────

vi.mock('@/app/auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// Mock @repo/data/tab-payment for settleTabCash (processConfirmedTabPayment).
vi.mock('@repo/data/tab-payment', () => ({
  processConfirmedTabPayment: vi.fn().mockResolvedValue(undefined),
  calculateTabTotal: vi.fn().mockResolvedValue({ ordersTotal: 0, serviceFee: 0, payableTotal: 0, orderIds: [] }),
}))

// Mock @repo/data/payment for getSite (resolveSiteFees) and restaurant deposit cascade
// (processChargedTableDeposit called by chargeRestaurantReservationDeposit).
vi.mock('@repo/data/payment', () => ({
  resolveSiteFees: vi.fn().mockResolvedValue([]),
  processChargedTableDeposit: vi.fn().mockResolvedValue(undefined),
  // Pure VAT helper — used by addProduct/updateProduct; return a stub that passes through
  computeVatAndBaseAmounts: vi.fn().mockReturnValue({ baseAmount: 10, vatAmount: 2 }),
}))

// Mock @repo/data/subscription for saveGeneral which calls getEffectiveSubscriptionForUser
vi.mock('@repo/data/subscription', () => ({
  getEffectiveSubscriptionForUser: vi.fn().mockResolvedValue({
    features: { OFF_PLATFORM_BILLING: false },
  }),
  resolveEffectiveFeatures: vi.fn().mockResolvedValue({}),
  canCreateSite: vi.fn().mockResolvedValue({ allowed: true, currentCount: 0, maxSites: 5, tier: 'PRO', overridden: false }),
}))

// Mock @/app/flags (used by lib/auth-helpers requireSiteOwnerWithFlag)
vi.mock('@/app/flags', () => ({
  isFlagEnabled: vi.fn().mockResolvedValue(true),
}))

// Mock @vercel/blob (used by uploadContentImage, updateProductImage, uploadSiteImage, addProduct)
vi.mock('@vercel/blob', () => ({
  put: vi.fn().mockResolvedValue({ url: 'https://blob.vercel-storage.com/test.jpg' }),
}))

// Mock sharp (used by uploadContentImage, updateProductImage, uploadSiteImage, addProduct)
vi.mock('sharp', () => ({
  default: vi.fn().mockReturnValue({
    metadata: vi.fn().mockResolvedValue({ width: 800, height: 600 }),
  }),
}))

// Mock @/app/api/_lib/mollie — imported by restaurants/[id]/reservations/actions.ts.
// refundDepositPayment is best-effort (try/catch), but the import must resolve in test env.
vi.mock('@/app/api/_lib/mollie', () => ({
  refundDepositPayment: vi.fn().mockResolvedValue(undefined),
}))

// Mock @repo/data/email — imported by restaurants/[id]/reservations/actions.ts for
// waitlist notification emails. Best-effort (try/catch); mock prevents real Resend import.
vi.mock('@repo/data/email', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}))

// Mock restaurants/[id]/queries — getRestaurantWaitlist is called by
// getRestaurantWaitlistForDay after auth passes.
vi.mock('@/app/restaurants/[id]/queries', () => ({
  getRestaurantWaitlist: vi.fn().mockResolvedValue([]),
  getRestaurant: vi.fn().mockResolvedValue(null),
  getRestaurantShifts: vi.fn().mockResolvedValue([]),
  getRestaurantCombinations: vi.fn().mockResolvedValue([]),
  getRestaurantLayout: vi.fn().mockResolvedValue(null),
  getRestaurantMenu: vi.fn().mockResolvedValue([]),
}))

// Mock @repo/table-reservations-core — the restaurant action files import heavily from
// this package, which transitively imports prisma driver, crypto, etc. and exhausts the
// V8 heap when loaded alongside all other gated action modules in a single worker.
//
// The auth-matrix tests only exercise the auth gate layer (partner-side requireRestaurant
// OwnerWithFlag / requireRestaurantOwner); the core functions are called AFTER auth passes.
// Stubbing the core here means:
//   - reject scenarios: partner gate rejects before core is reached → correct
//   - ok scenarios: partner gate passes → core stub returns ok → assertOk sees no auth error
//
// Downstream correctness of core functions is covered by the dedicated restaurant action
// test files (actions.test.ts, tables/actions.test.ts, menu/actions.test.ts, etc.).
vi.mock('@repo/table-reservations-core', () => ({
  // Restaurant CRUD
  createRestaurant: vi.fn().mockResolvedValue({ status: 'ok', restaurant: { id: 'r1' } }),
  updateRestaurant: vi.fn().mockResolvedValue({ status: 'ok' }),
  uniqueRestaurantSlug: vi.fn().mockResolvedValue('test-restaurant'),

  // Hours
  setRestaurantHours: vi.fn().mockResolvedValue({ status: 'ok' }),

  // Shifts
  setRestaurantShifts: vi.fn().mockResolvedValue({ status: 'ok' }),

  // Combinations
  createCombination: vi.fn().mockResolvedValue({ status: 'ok' }),
  updateCombination: vi.fn().mockResolvedValue({ status: 'ok' }),
  deleteCombination: vi.fn().mockResolvedValue({ status: 'ok' }),

  // Menu
  createMenuItem: vi.fn().mockResolvedValue({ status: 'ok' }),
  updateMenuItem: vi.fn().mockResolvedValue({ status: 'ok' }),
  archiveMenuItem: vi.fn().mockResolvedValue({ status: 'ok' }),
  setMenuItemSoldOut: vi.fn().mockResolvedValue({ status: 'ok' }),
  reorderMenuItems: vi.fn().mockResolvedValue({ status: 'ok' }),

  // Tables
  createTable: vi.fn().mockResolvedValue({ status: 'ok' }),
  updateTable: vi.fn().mockResolvedValue({ status: 'ok' }),
  duplicateTable: vi.fn().mockResolvedValue({ status: 'ok' }),
  deleteTable: vi.fn().mockResolvedValue({ status: 'ok' }),

  // Layout elements (restaurant-scoped)
  createLayoutElement: vi.fn().mockResolvedValue({ status: 'ok' }),
  updateLayoutElement: vi.fn().mockResolvedValue({ status: 'ok' }),
  deleteLayoutElement: vi.fn().mockResolvedValue({ status: 'ok' }),

  // Reservations (staff ops)
  listReservationsForDay: vi.fn().mockResolvedValue([]),
  markSeated: vi.fn().mockResolvedValue({ status: 'ok' }),
  markDeparted: vi.fn().mockResolvedValue({ status: 'ok' }),
  markNoShow: vi.fn().mockResolvedValue({ status: 'ok' }),
  cancelReservationAsStaff: vi.fn().mockResolvedValue({ status: 'ok' }),
  updateReservationInternalNotes: vi.fn().mockResolvedValue({ status: 'ok' }),
  modifyReservationAsStaff: vi.fn().mockResolvedValue({ status: 'ok' }),
  chargeNoShowDeposit: vi.fn().mockResolvedValue({ status: 'ok' }),

  // Waitlist
  findWaitlistCandidateForFreedReservation: vi.fn().mockResolvedValue(null),
  markWaitlistNotified: vi.fn().mockResolvedValue({ status: 'ok' }),
  removeWaitlistEntryAsStaff: vi.fn().mockResolvedValue({ status: 'ok' }),
  waitlistNotifyEmailHtml: vi.fn().mockReturnValue('<html>notify</html>'),

  // Deposit (status constant needed by reservations/actions.ts)
  DEPOSIT_STATUS: {
    HELD: 'held',
    CHARGED: 'charged',
    REFUNDED: 'refunded',
    RELEASED: 'released',
  },
}))

// ─── Imports (after mock declarations) ───────────────────────────────────────

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { GATED_ACTIONS } from './gated-actions'
import { runAuthMatrix } from './auth-matrix'
import {
  OWNER_ID,
  SITE_ID,
  ITEM_ID,
  RES_ID,
  BOOKING_ID,
  ORDER_ID,
  PRODUCT_ID,
  RENTAL_ITEM_ID,
  RESTAURANT_ID,
  TABLE_ID,
  MENU_ITEM_ID,
  TABLE_RES_ID,
  WAITLIST_ENTRY_ID,
  COMBINATION_ID,
  RESTAURANT_ELEMENT_ID,
  TAB_ID,
} from './token-fixtures'
import {
  WORKING_HOURS_ID,
  LAYOUT_ELEMENT_ID,
  ITEM_GROUP_ID,
} from './gated-actions'

// ─── Per-test reset ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()

  // Reset auth to unauthenticated — scenario apply() will override per scenario.
  // (clearAllMocks clears call history but not implementations, so we must reset
  // explicitly to avoid leaking session state between tests.)
  vi.mocked(auth).mockResolvedValue(null)

  // Default downstream stubs so that authorized scenarios don't error on
  // missing prisma returns. Each action's "ok" scenario needs enough stubs
  // for the happy path after auth passes.
  //
  // Note: manage actions call site.findUnique for the ownership check, then
  // may call other models. We set sensible defaults here; individual action
  // tests in their own test files handle exhaustive happy-path coverage.

  vi.mocked(prisma.site.findUnique).mockResolvedValue({
    userId: OWNER_ID,
    features: [],
    layoutMode: 'geo',
  } as any)
  vi.mocked(prisma.site.findFirst).mockResolvedValue({ id: SITE_ID, userId: OWNER_ID } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as any)
  vi.mocked(prisma.securityToken.findUnique).mockResolvedValue(null)

  // Reservation stubs (for manage actions that look up a reservation after auth)
  vi.mocked(prisma.reservation.findUnique).mockResolvedValue({
    id: RES_ID,
    siteId: SITE_ID,
    operationalStatus: 'expected',
    items: [],
    // P1: checkIn/depart/noShow now request the site relation for tz-resolution
    site: { timeZone: 'Europe/Madrid', locationLat: '40.4', locationLng: '-3.7' },
  } as any)
  // P1: getTodayStatus reads reservationDay; return null so actions fall back to parent status
  vi.mocked(prisma.reservationDay.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.reservationDay.upsert).mockResolvedValue({ id: 'rd-1', operationalStatus: 'expected', checkedInAt: null, departedAt: null } as any)
  vi.mocked(prisma.reservation.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.reservation.create).mockResolvedValue({ id: 'new-res' } as any)
  vi.mocked(prisma.reservation.update).mockResolvedValue({} as any)
  vi.mocked(prisma.reservation.updateMany).mockResolvedValue({ count: 0 } as any)
  vi.mocked(prisma.reservation.deleteMany).mockResolvedValue({ count: 1 } as any)
  vi.mocked(prisma.reservation.findMany).mockResolvedValue([])

  // InventoryItem stubs (for manage actions: moveReservation, addSeatToGroup, etc.)
  vi.mocked(prisma.inventoryItem.findUnique).mockResolvedValue({
    id: ITEM_ID,
    siteId: SITE_ID,
    status: 'pool',
    group: 1,
    number: 19901,
    sunbedGroupId: null,
    pairId: null,
    pairedBy: null,
    itemGroupId: null,
    locationLat: '60.1',
    locationLng: '24.9',
    schematicX: null,
    schematicY: null,
    rotation: 0,
    site: { userId: OWNER_ID },
  } as any)
  vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([])
  vi.mocked(prisma.inventoryItem.findFirst).mockResolvedValue({
    id: ITEM_ID,
    siteId: SITE_ID,
    itemGroupId: null,
    site: { userId: OWNER_ID },
  } as any)
  vi.mocked(prisma.inventoryItem.create).mockResolvedValue({ id: 'new-item' } as any)
  vi.mocked(prisma.inventoryItem.update).mockResolvedValue({} as any)
  vi.mocked(prisma.inventoryItem.updateMany).mockResolvedValue({ count: 0 } as any)
  vi.mocked(prisma.inventoryItem.delete).mockResolvedValue({} as any)
  vi.mocked(prisma.inventoryItem.deleteMany).mockResolvedValue({ count: 1 } as any)
  vi.mocked(prisma.inventoryItem.count).mockResolvedValue(0)

  // RentalBooking stubs (for markRentalPickedUp/Returned, createWalkInRental,
  // collectRentalPayment, getRentalCollectStatus, cancelRentalCollection)
  vi.mocked(prisma.rentalBooking.findUnique).mockResolvedValue({
    id: BOOKING_ID,
    siteId: SITE_ID,
    status: 'paid-in-cash',
    paymentRef: null,
    operationalStatus: 'reserved',
  } as any)
  vi.mocked(prisma.rentalBooking.findMany).mockResolvedValue([
    {
      id: BOOKING_ID,
      siteId: SITE_ID,
      status: 'paid-in-cash',
      paymentAmount: 10,
      anonId: null,
    },
  ] as any)
  vi.mocked(prisma.rentalBooking.create).mockResolvedValue({ id: 'new-booking' } as any)
  vi.mocked(prisma.rentalBooking.update).mockResolvedValue({} as any)
  vi.mocked(prisma.rentalBooking.updateMany).mockResolvedValue({ count: 1 } as any)
  vi.mocked(prisma.rentalBooking.aggregate).mockResolvedValue({ _sum: { quantity: 0 } } as any)
  vi.mocked(prisma.rentalBooking.count).mockResolvedValue(0)

  // RentalItem stubs (for createWalkInRental, updateRentalItem, deleteRentalItem)
  vi.mocked(prisma.rentalItem.findUnique).mockResolvedValue({
    id: RENTAL_ITEM_ID,
    siteId: SITE_ID,
  } as any)
  vi.mocked(prisma.rentalItem.findMany).mockResolvedValue([
    {
      id: RENTAL_ITEM_ID,
      siteId: SITE_ID,
      active: true,
      totalQuantity: 10,
      pricePerHour: 5,
      pricePerDay: 20,
      name: 'Kayak',
    },
  ] as any)
  vi.mocked(prisma.rentalItem.create).mockResolvedValue({ id: RENTAL_ITEM_ID } as any)
  vi.mocked(prisma.rentalItem.update).mockResolvedValue({} as any)
  vi.mocked(prisma.rentalItem.delete).mockResolvedValue({} as any)

  // Order stubs (for setOrderStatus, getOrders)
  vi.mocked(prisma.order.findUnique).mockResolvedValue({
    id: ORDER_ID,
    siteId: SITE_ID,
    status: 'complete',
  } as any)
  vi.mocked(prisma.order.findMany).mockResolvedValue([])
  vi.mocked(prisma.order.update).mockResolvedValue({} as any)
  vi.mocked(prisma.order.updateMany).mockResolvedValue({ count: 0 } as any)

  // TableTab stubs (for getOpenTabs, settleTabCash, discardTab)
  vi.mocked(prisma.tableTab.findMany).mockResolvedValue([])
  vi.mocked(prisma.tableTab.findUnique).mockResolvedValue({
    id: TAB_ID,
    siteId: SITE_ID,
    status: 'open',
    orders: [],
  } as any)
  vi.mocked(prisma.tableTab.update).mockResolvedValue({} as any)

  // Product stubs (for toggleProductSoldOut, updateProduct, deleteProduct, updateProductImage)
  // Must include site.userId for actions that do manual ownership check via product.site.userId
  vi.mocked(prisma.product.findUnique).mockResolvedValue({
    id: PRODUCT_ID,
    siteId: SITE_ID,
    tax: 24,
    totalPrice: 10,
    site: { userId: OWNER_ID },
  } as any)
  vi.mocked(prisma.product.findMany).mockResolvedValue([])
  vi.mocked(prisma.product.create).mockResolvedValue({ id: 'new-product' } as any)
  vi.mocked(prisma.product.update).mockResolvedValue({} as any)

  // SunbedGroup stubs (for addSeatToGroup, pairInventoryItems, etc.)
  vi.mocked(prisma.sunbedGroup.create).mockResolvedValue({ id: 'new-group' } as any)
  vi.mocked(prisma.sunbedGroup.delete).mockResolvedValue({} as any)

  // Site stubs for session-owner actions (deleteSite, setPaymentProvider, saveGeneral)
  vi.mocked(prisma.site.update).mockResolvedValue({} as any)
  vi.mocked(prisma.site.delete).mockResolvedValue({} as any)
  vi.mocked(prisma.partnerAccount.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.partnerAccount.update).mockResolvedValue({} as any)
  vi.mocked(prisma.siteBrand.upsert).mockResolvedValue({} as any)
  vi.mocked(prisma.$executeRaw as any).mockResolvedValue(1)
  // moveParcel's absolute-target base read (locked FOR UPDATE) — one row with
  // coordinates so the happy path computes a finite delta.
  vi.mocked(prisma.$queryRaw as any).mockResolvedValue([
    { location_lat: '36.72', location_lng: '-4.42', schematic_x: 0, schematic_y: 0 },
  ])

  // getSite stubs (for queries.getSite — will be called even without auth guard)
  // Overrides the findFirst above to return null (simulate no site found)
  // This is intentionally weak; getSite will error with undefined status (bug #1)
  vi.mocked(prisma.site.findFirst).mockResolvedValue(null)

  // SiteWorkingHours stubs (for updateWorkingHours, deleteWorkingHours, addWorkingHours)
  vi.mocked(prisma.siteWorkingHours.findUnique).mockResolvedValue({
    id: WORKING_HOURS_ID,
    siteId: SITE_ID,
    site: { userId: OWNER_ID },
  } as any)
  vi.mocked(prisma.siteWorkingHours.findMany).mockResolvedValue([])
  vi.mocked(prisma.siteWorkingHours.create).mockResolvedValue({ id: WORKING_HOURS_ID } as any)
  vi.mocked(prisma.siteWorkingHours.update).mockResolvedValue({} as any)
  vi.mocked(prisma.siteWorkingHours.delete).mockResolvedValue({} as any)

  // LayoutElement stubs — shared by:
  //   schematic/actions.ts (site-keyed): updateLayoutElement/deleteLayoutElement
  //     check existing.siteId to resolve siteId → requireSiteOwner
  //   restaurant tables/actions.ts (restaurant-keyed via core): updateElementForRestaurant/
  //     deleteElementForRestaurant → core updateLayoutElement/deleteLayoutElement
  //     check existing.restaurantId → requireRestaurantOwner
  // Include both fields so the same stub satisfies both code paths.
  vi.mocked(prisma.layoutElement.findUnique).mockResolvedValue({
    id: LAYOUT_ELEMENT_ID,
    siteId: SITE_ID,
    restaurantId: RESTAURANT_ID,
  } as any)
  vi.mocked(prisma.layoutElement.findMany).mockResolvedValue([
    { id: LAYOUT_ELEMENT_ID },
  ] as any)
  vi.mocked(prisma.layoutElement.create).mockResolvedValue({ id: LAYOUT_ELEMENT_ID } as any)
  vi.mocked(prisma.layoutElement.update).mockResolvedValue({} as any)
  vi.mocked(prisma.layoutElement.delete).mockResolvedValue({} as any)

  // ItemGroup stubs (for inventory/actions.ts: syncChairsWithLayout, moveParcel, etc.)
  vi.mocked(prisma.itemGroup.findUnique).mockResolvedValue({
    id: ITEM_GROUP_ID,
    siteId: SITE_ID,
    locationLat: '60.1',
    locationLng: '24.9',
    schematicX: null,
    schematicY: null,
    rotation: 0,
    horizontalGap: 2.5,
    verticalGap: 2.5,
    items: [
      { site: { userId: OWNER_ID } },
    ],
  } as any)
  vi.mocked(prisma.itemGroup.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.itemGroup.create).mockResolvedValue({ id: ITEM_GROUP_ID } as any)
  vi.mocked(prisma.itemGroup.update).mockResolvedValue({} as any)

  // ── Restaurant stubs ──────────────────────────────────────────────────────
  //
  // Default: restaurant owned by OWNER_ID. The apply* helpers for restaurant-owner
  // scenarios override this per-scenario (applyRestaurantOwnerSession leaves this
  // intact; applyRestaurantNonOwnerSession overrides partnerAccountId to OTHER_USER_ID).
  //
  // Note: the default here is deliberately set so that session-owner actions
  // (e.g. restaurant-actions.createRestaurant which uses siteId/site-owner path)
  // do NOT hit the restaurant mock at all — they use the site mock set by
  // applyOwnerSession/applyNonOwnerSession.
  vi.mocked(prisma.restaurant.findUnique).mockResolvedValue({
    id: RESTAURANT_ID,
    partnerAccountId: OWNER_ID,
    siteId: SITE_ID,
    name: 'Test Restaurant',
    slug: 'test-restaurant',
    tagline: null,
    description: null,
    cuisineType: null,
    priceRange: null,
    averageMealDuration: 120,
    reservationWindow: 60,
    layoutWidth: 20,
    layoutHeight: 15,
    publicOnStandaloneApp: true,
    workingHours: [],
  } as any)
  vi.mocked(prisma.restaurant.findMany).mockResolvedValue([])
  vi.mocked(prisma.restaurant.create).mockResolvedValue({ id: RESTAURANT_ID } as any)
  vi.mocked(prisma.restaurant.update).mockResolvedValue({} as any)

  // RestaurantHours stubs (for setRestaurantOpeningHours → core setRestaurantHours)
  vi.mocked(prisma.restaurantHours.findMany).mockResolvedValue([])
  vi.mocked(prisma.restaurantHours.deleteMany).mockResolvedValue({ count: 0 } as any)
  vi.mocked(prisma.restaurantHours.createMany).mockResolvedValue({ count: 1 } as any)

  // RestaurantShift stubs (for setRestaurantServiceShifts → core setRestaurantShifts)
  vi.mocked(prisma.restaurantShift.deleteMany).mockResolvedValue({ count: 0 } as any)
  vi.mocked(prisma.restaurantShift.createMany).mockResolvedValue({ count: 0 } as any)
  vi.mocked(prisma.restaurantShift.findMany).mockResolvedValue([])

  // Table stubs (for createTableForRestaurant, updateTableForRestaurant, etc.)
  // updateTableForRestaurant and duplicateTableForRestaurant look up the table by id
  // to get its restaurantId before calling requireRestaurantOwner.
  vi.mocked(prisma.table.findUnique).mockResolvedValue({
    id: TABLE_ID,
    restaurantId: RESTAURANT_ID,
    number: 1,
    label: null,
    capacity: 4,
    minPartySize: 1,
    maxPartySize: null,
    shape: 'square',
    width: 1.5,
    height: 1.5,
    schematicX: 5,
    schematicY: 5,
    rotation: 0,
    status: 'active',
    zone: null,
    staffNote: null,
    onlineBookable: true,
    combinable: false,
    guestSelectable: false,
    features: [],
    requiresDeposit: null,
    depositPerGuest: null,
    turnTimeMinutes: null,
    locked: false,
    seatsTop: null,
    seatsRight: null,
    seatsBottom: null,
    seatsLeft: null,
  } as any)
  vi.mocked(prisma.table.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.table.findMany).mockResolvedValue([])
  vi.mocked(prisma.table.create).mockResolvedValue({ id: TABLE_ID } as any)
  vi.mocked(prisma.table.update).mockResolvedValue({} as any)
  vi.mocked(prisma.table.delete).mockResolvedValue({} as any)

  // MenuItem stubs (for menu actions: updateMenuItemForRestaurant, archiveMenuItem, etc.)
  // updateMenuItemForRestaurant / archiveMenuItemForRestaurant / setMenuItemSoldOut look
  // up the item first to get its restaurantId before calling requireRestaurantOwner.
  vi.mocked(prisma.menuItem.findUnique).mockResolvedValue({
    id: MENU_ITEM_ID,
    restaurantId: RESTAURANT_ID,
    name: 'Fish',
    price: 15,
    category: 'main',
    active: true,
    soldOut: false,
    displayOrder: 0,
    imageUrl: null,
    description: null,
  } as any)
  vi.mocked(prisma.menuItem.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.menuItem.findMany).mockResolvedValue([
    { id: MENU_ITEM_ID, restaurantId: RESTAURANT_ID },
  ] as any)
  vi.mocked(prisma.menuItem.create).mockResolvedValue({ id: MENU_ITEM_ID } as any)
  vi.mocked(prisma.menuItem.update).mockResolvedValue({} as any)

  // TableCombination stubs (for combination actions)
  // core deleteCombination / updateCombination look up the combination first.
  vi.mocked(prisma.tableCombination.findUnique).mockResolvedValue({
    id: COMBINATION_ID,
    restaurantId: RESTAURANT_ID,
    name: null,
    capacity: 8,
    tableIds: [TABLE_ID],
  } as any)
  vi.mocked(prisma.tableCombination.findMany).mockResolvedValue([])
  vi.mocked(prisma.tableCombination.create).mockResolvedValue({ id: COMBINATION_ID } as any)
  vi.mocked(prisma.tableCombination.update).mockResolvedValue({} as any)
  vi.mocked(prisma.tableCombination.delete).mockResolvedValue({} as any)

  // TableReservation stubs (for reservation management actions)
  //
  // markSeated/markDeparted/markNoShow/cancelReservation/setNotes use requireStaffOwner
  // which queries tableReservation to get restaurant.partnerAccountId.
  // modifyReservationAsStaff also calls reapplyReservation which queries the reservation again.
  // chargeRestaurantReservationDeposit queries tableReservation for depositStatus + paymentRef.
  // getRestaurantReservationsForDay uses the core listReservationsForDay (queries tableReservation).
  vi.mocked(prisma.tableReservation.findUnique).mockResolvedValue({
    id: TABLE_RES_ID,
    restaurantId: RESTAURANT_ID,
    tableId: TABLE_ID,
    status: 'confirmed',
    operationalStatus: 'pending',
    partySize: 2,
    from: new Date('2025-07-01T12:00:00Z'),
    to: new Date('2025-07-01T14:00:00Z'),
    bookingGroupId: null,
    depositStatus: 'none',
    depositAmount: null,
    paymentRef: null,
    internalNotes: null,
    restaurant: { partnerAccountId: OWNER_ID },
  } as any)
  vi.mocked(prisma.tableReservation.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.tableReservation.findMany).mockResolvedValue([])
  vi.mocked(prisma.tableReservation.count).mockResolvedValue(0)
  vi.mocked(prisma.tableReservation.update).mockResolvedValue({} as any)
  vi.mocked(prisma.tableReservation.updateMany).mockResolvedValue({ count: 1 } as any)
  vi.mocked(prisma.tableReservation.create).mockResolvedValue({ id: TABLE_RES_ID } as any)

  // TableWaitlistEntry stubs (for removeRestaurantWaitlistEntry)
  // removeWaitlistEntryAsStaff looks up the entry to get restaurantId.
  vi.mocked(prisma.tableWaitlistEntry.findUnique).mockResolvedValue({
    id: WAITLIST_ENTRY_ID,
    restaurantId: RESTAURANT_ID,
  } as any)
  vi.mocked(prisma.tableWaitlistEntry.findMany).mockResolvedValue([])
  vi.mocked(prisma.tableWaitlistEntry.update).mockResolvedValue({} as any)
  vi.mocked(prisma.tableWaitlistEntry.delete).mockResolvedValue({} as any)

})

// ─── Matrix ───────────────────────────────────────────────────────────────────

for (const entry of GATED_ACTIONS) {
  describe(entry.name, () => {
    runAuthMatrix(entry)
  })
}
