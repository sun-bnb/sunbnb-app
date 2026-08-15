/**
 * Gated-action registry — Phase 0.2 of the partner test-architecture track.
 *
 * A GatedAction entry pairs an action's human name + gate type with a closure
 * invoker that calls the real action with stable stub arguments. Registering
 * an action here auto-applies the full auth-rejection matrix from
 * auth-matrix.ts.
 *
 * Invokers are closures typed against the real action signatures (TS-checked).
 * They must call the action with enough arguments to reach the auth gate — they
 * do NOT need to satisfy downstream Prisma calls (those are mocked per scenario).
 *
 * Naming convention: '<domain>.<action>' mirroring the source file path.
 *
 * THROW-NORMALISATION: A handful of actions throw Error() instead of returning
 * { status: 'error', errors: [...] }. Their invokers wrap the call and
 * normalise the thrown message into the expected shape so the matrix runner can
 * apply its predicate uniformly. This is a harness-only adapter — it does NOT
 * change what the real action does.
 */

import {
  reserveItem,
  reserveItems,
  unreserveItem,
  checkInReservation,
  resumeWalkIn,
  undoDepartWalkIn,
  markDeparted,
  markNoShow,
  updateReservationNotes,
  moveReservation,
  moveReservationToSeats,
  blockBed,
  blockBeds,
  unblockBed,
  holdBed,
  holdBeds,
  compBed,
  compBeds,
  uncompBed,
  cancelReservation,
  refundReservation,
  releaseHold,
  convertHoldToWalkIn,
  markRentalPickedUp,
  markRentalReturned,
  createWalkInRental,
  createPoolSeat,
  addSeatToGroup,
  removeGroupSeat,
  deletePoolSeat,
  removeFailedReservation,
  collectReservationPayment,
  getCollectStatus,
  cancelCollection,
  splitWalkInSeat,
  collectRentalPayment,
  getRentalCollectStatus,
  cancelRentalCollection,
  getTillStatus,
  closeTill,
  findReservations,
  settleReservation,
  getOpenTills,
  getOpenTillItems,
  getTillDayReport,
  closeDay,
  getDayShiftItems,
  getManageTrends,
  getManageTrendsCsv,
} from '@/app/sites/[id]/manage/actions'

import {
  setOrderStatus,
  getOrders,
  toggleProductSoldOut as ordersToggleProductSoldOut,
  getOpenTabs,
  settleTabCash,
  discardTab,
} from '@/app/sites/[id]/orders/actions'

import {
  setRestaurantOrderStatus,
  getRestaurantOrders,
  getRestaurantOpenTabs,
  settleRestaurantTabCash,
  discardRestaurantTab,
} from '@/app/restaurants/[id]/orders/actions'

import {
  getRestaurantTabInvoicesByMonth,
} from '@/app/restaurants/[id]/accounting/actions'

import {
  deleteSite,
  setPaymentProvider,
  saveGeneral,
  saveLayoutDimensions,
  setSiteStatus,
  saveBrand,
  submitForm,
} from '@/app/sites/[id]/site-actions'


import {
  createPartnerReservation,
  getAvailableSunbeds,
} from '@/app/calendar/actions'

import {
  createInventoryItem,
  deleteInventoryItem,
  saveInventoryItemLocation,
  saveInventoryItemSchematicLocation,
  saveInventoryItemProperties,
  pairInventoryItems,
  depairInventoryItem,
  deleteItemsByGroup,
} from '@/app/sites/[id]/inventory-actions'

import {
  syncChairsWithLayout,
  getItemGroup,
  moveParcel,
  moveItems,
  setItemStatusByGroup,
  rotateSelection,
  adjustItemSpacing,
  assignItemsToGroup,
  removeItemsFromGroup,
  reverseParcelNumbering,
  reverseParcelOrientation,
} from '@/app/sites/[id]/inventory/actions'

import {
  setRentalPaymentType,
  getRentalItems,
  createRentalItem,
  updateRentalItem,
  deleteRentalItem,
  saveRentalVat,
  toggleSiteFeature,
} from '@/app/sites/[id]/rentals/actions'

import {
  addWorkingHours,
  updateWorkingHours,
  deleteWorkingHours,
} from '@/app/sites/[id]/working-hours-actions'

import {
  saveContentFields,
  uploadContentImage,
} from '@/app/sites/[id]/content-actions'

import {
  toggleAppSales,
  setOrderPaymentType,
  addProduct,
  updateProduct,
  updateProductImage,
  deleteProduct,
  toggleProductSoldOut as productsToggleProductSoldOut,
} from '@/app/sites/[id]/products/actions'

import {
  createLayoutElement,
  updateLayoutElement,
  deleteLayoutElement,
  reorderLayoutElements,
} from '@/app/sites/[id]/schematic/actions'

import {
  uploadSiteImage,
} from '@/app/sites/create/actions'

import {
  createRestaurant,
  updateRestaurantSettings,
  setRestaurantOpeningHours,
  setRestaurantServiceShifts,
  createRestaurantCombination,
  updateRestaurantCombination,
  deleteRestaurantCombination,
} from '@/app/restaurants/[id]/actions'

import {
  createMenuItemForRestaurant,
  updateMenuItemForRestaurant,
  archiveMenuItemForRestaurant,
  setMenuItemSoldOutForRestaurant,
  reorderMenuItemsForRestaurant,
} from '@/app/restaurants/[id]/menu/actions'

import {
  getRestaurantReservationsForDay,
  markRestaurantReservationSeated,
  markRestaurantReservationDeparted,
  markRestaurantReservationNoShow,
  cancelRestaurantReservation,
  setRestaurantReservationNotes,
  modifyRestaurantReservation,
  chargeRestaurantReservationDeposit,
  getRestaurantWaitlistForDay,
  removeRestaurantWaitlistEntry,
} from '@/app/restaurants/[id]/reservations/actions'

import {
  createTableForRestaurant,
  updateTableForRestaurant,
  duplicateTableForRestaurant,
  deleteTableForRestaurant,
  createElementForRestaurant,
  updateElementForRestaurant,
  deleteElementForRestaurant,
  saveRestaurantCanvasDimensions,
} from '@/app/restaurants/[id]/tables/actions'

import {
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

// ─── Stable stub IDs ─────────────────────────────────────────────────────────

export const WORKING_HOURS_ID = 'matrix-wh-1'
export const LAYOUT_ELEMENT_ID = 'matrix-layout-elem-1'
export const ITEM_GROUP_ID = 'matrix-item-group-1'

// ─── Types ─────────────────────────────────────────────────────────────────

export type GateType =
  | 'session-owner'
  | 'token-or-session'
  | 'admin-token'
  | 'restaurant-owner'
  | 'restaurant-token-or-session'
  | 'cron'
  | 'signature'

export interface GatedAction {
  /** '<domain>.<action>' — used as describe() label and registry key */
  name: string
  /** 'action' for server actions (return { status }); 'route' for route handlers */
  kind: 'action' | 'route'
  /** Which gate guards this action */
  gate: GateType
  /**
   * Closure invoker. Calls the real action with stable stub arguments.
   * For token-or-session actions, accessKey is passed when testing the token path.
   * For session-owner actions, accessKey is undefined/not accepted.
   */
  invoke: (accessKey?: string) => Promise<unknown>
}

// ─── Throw-normaliser ────────────────────────────────────────────────────────

/**
 * Some actions (getItemGroup, setItemStatusByGroup) throw Error() instead of
 * returning { status: 'error', errors: [...] }. Wrap them to normalise the
 * thrown message into the standard shape so the matrix predicate applies.
 */
async function normaliseThrow(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    return await fn()
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { status: 'error', errors: [msg] }
  }
}

// ─── Registry ───────────────────────────────────────────────────────────────

export const GATED_ACTIONS: GatedAction[] = [
  // ══════════════════════════════════════════════════════════════════════════
  // token-or-session: manage/actions.ts — verifySiteOwnership delegates to
  // the canonical verifySiteAccess (lib/auth-helpers.ts):
  // resources: hasSome ['all', 'manage_site']
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'manage.reserveItem',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => reserveItem(SITE_ID, ITEM_ID, undefined, undefined, accessKey),
  },
  {
    name: 'manage.unreserveItem',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => unreserveItem(SITE_ID, ITEM_ID, accessKey),
  },
  {
    name: 'manage.checkInReservation',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => checkInReservation(SITE_ID, RES_ID, accessKey),
  },
  {
    name: 'manage.markDeparted',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => markDeparted(SITE_ID, RES_ID, accessKey),
  },
  {
    name: 'manage.markNoShow',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => markNoShow(SITE_ID, RES_ID, accessKey),
  },
  {
    name: 'manage.updateReservationNotes',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => updateReservationNotes(SITE_ID, RES_ID, 'notes', accessKey),
  },
  {
    name: 'manage.moveReservation',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => moveReservation(SITE_ID, RES_ID, [ITEM_ID], accessKey),
  },
  {
    name: 'manage.moveReservationToSeats',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => moveReservationToSeats(SITE_ID, RES_ID, [ITEM_ID], accessKey),
  },
  {
    name: 'manage.blockBed',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => blockBed(SITE_ID, ITEM_ID, undefined, accessKey),
  },
  {
    name: 'manage.unblockBed',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => unblockBed(SITE_ID, ITEM_ID, accessKey),
  },
  {
    name: 'manage.holdBed',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => holdBed(SITE_ID, ITEM_ID, accessKey),
  },
  {
    name: 'manage.compBed',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => compBed(SITE_ID, ITEM_ID, accessKey),
  },
  {
    name: 'manage.uncompBed',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => uncompBed(SITE_ID, ITEM_ID, accessKey),
  },
  {
    name: 'manage.markRentalPickedUp',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => markRentalPickedUp(SITE_ID, BOOKING_ID, accessKey),
  },
  {
    name: 'manage.markRentalReturned',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => markRentalReturned(SITE_ID, BOOKING_ID, accessKey),
  },
  {
    name: 'manage.createWalkInRental',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) =>
      createWalkInRental({
        siteId: SITE_ID,
        items: [{ rentalItemId: RENTAL_ITEM_ID, quantity: 1 }],
        durationType: 'hours',
        hours: 2,
        paymentType: 'cash',
        accessKey,
      }),
  },
  {
    name: 'manage.createPoolSeat',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => createPoolSeat(SITE_ID, 1, accessKey),
  },
  {
    name: 'manage.addSeatToGroup',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => addSeatToGroup(SITE_ID, ITEM_ID, accessKey),
  },
  {
    name: 'manage.removeGroupSeat',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => removeGroupSeat(SITE_ID, ITEM_ID, accessKey),
  },
  {
    name: 'manage.deletePoolSeat',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => deletePoolSeat(SITE_ID, ITEM_ID, accessKey),
  },
  {
    name: 'manage.cancelReservation',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => cancelReservation(SITE_ID, ITEM_ID, accessKey),
  },
  {
    name: 'manage.refundReservation',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => refundReservation(SITE_ID, ITEM_ID, accessKey),
  },
  {
    name: 'manage.releaseHold',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => releaseHold(SITE_ID, ITEM_ID, accessKey),
  },
  {
    name: 'manage.convertHoldToWalkIn',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => convertHoldToWalkIn(SITE_ID, ITEM_ID, accessKey),
  },
  {
    name: 'manage.removeFailedReservation',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => removeFailedReservation(SITE_ID, RES_ID, accessKey),
  },
  {
    name: 'manage.collectReservationPayment',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => collectReservationPayment(SITE_ID, RES_ID, accessKey),
  },
  {
    name: 'manage.getCollectStatus',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => getCollectStatus(SITE_ID, RES_ID, accessKey),
  },
  {
    name: 'manage.cancelCollection',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => cancelCollection(SITE_ID, RES_ID, accessKey),
  },
  {
    name: 'manage.splitWalkInSeat',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => splitWalkInSeat(SITE_ID, RES_ID, ITEM_ID, accessKey),
  },
  {
    name: 'manage.collectRentalPayment',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => collectRentalPayment(SITE_ID, [BOOKING_ID], accessKey),
  },
  {
    name: 'manage.getRentalCollectStatus',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => getRentalCollectStatus(SITE_ID, BOOKING_ID, accessKey),
  },
  {
    name: 'manage.cancelRentalCollection',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => cancelRentalCollection(SITE_ID, BOOKING_ID, accessKey),
  },
  {
    name: 'manage.getTillStatus',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => getTillStatus(SITE_ID, 'matrix-emp-1', accessKey),
  },
  {
    name: 'manage.closeTill',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => closeTill(SITE_ID, 'matrix-emp-1', accessKey),
  },
  {
    name: 'manage.findReservations',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => findReservations(SITE_ID, undefined, accessKey),
  },
  {
    name: 'manage.reserveItems',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => reserveItems(SITE_ID, [ITEM_ID], undefined, undefined, accessKey),
  },
  {
    name: 'manage.holdBeds',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => holdBeds(SITE_ID, [ITEM_ID], accessKey),
  },
  {
    name: 'manage.blockBeds',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => blockBeds(SITE_ID, [ITEM_ID], undefined, accessKey),
  },
  {
    name: 'manage.compBeds',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => compBeds(SITE_ID, [ITEM_ID], accessKey),
  },
  {
    name: 'manage.resumeWalkIn',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => resumeWalkIn(SITE_ID, RES_ID, accessKey),
  },
  {
    name: 'manage.undoDepartWalkIn',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => undoDepartWalkIn(SITE_ID, RES_ID, accessKey),
  },
  {
    name: 'manage.settleReservation',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => settleReservation(SITE_ID, RES_ID, 10, accessKey),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // admin-token: manage/actions.ts — guarded by verifySiteAdmin (lib/auth-helpers.ts)
  // Requires 'admin' in token resources. A plain 'all'/'manage_site' token is
  // rejected. Owner/sudo session passes via the session fallback.
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'manage.getOpenTills',
    kind: 'action',
    gate: 'admin-token',
    invoke: (accessKey?) => getOpenTills(SITE_ID, accessKey),
  },
  {
    name: 'manage.getOpenTillItems',
    kind: 'action',
    gate: 'admin-token',
    invoke: (accessKey?) => getOpenTillItems(SITE_ID, accessKey),
  },
  {
    name: 'manage.getTillDayReport',
    kind: 'action',
    gate: 'admin-token',
    invoke: (accessKey?) => getTillDayReport(SITE_ID, '2025-07-01', accessKey),
  },
  {
    name: 'manage.closeDay',
    kind: 'action',
    gate: 'admin-token',
    invoke: (accessKey?) => closeDay(SITE_ID, accessKey),
  },
  {
    name: 'manage.getDayShiftItems',
    kind: 'action',
    gate: 'admin-token',
    invoke: (accessKey?) => getDayShiftItems(SITE_ID, '2025-07-01', accessKey),
  },
  {
    name: 'manage.getManageTrends',
    kind: 'action',
    gate: 'admin-token',
    invoke: (accessKey?) => getManageTrends(SITE_ID, 30, accessKey),
  },
  {
    name: 'manage.getManageTrendsCsv',
    kind: 'action',
    gate: 'admin-token',
    invoke: (accessKey?) => getManageTrendsCsv(SITE_ID, 30, accessKey),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // token-or-session: orders/actions.ts — guarded by verifySiteAccess
  // (same unified gate as manage above: hasSome ['all', 'manage_site'])
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'orders.setOrderStatus',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => setOrderStatus(SITE_ID, ORDER_ID, 'accepted', undefined, accessKey),
  },
  {
    name: 'orders.getOrders',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => getOrders(SITE_ID, 'incoming', accessKey),
  },
  {
    name: 'orders.toggleProductSoldOut',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => ordersToggleProductSoldOut(SITE_ID, PRODUCT_ID, true, accessKey),
  },
  {
    name: 'orders.getOpenTabs',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => getOpenTabs(SITE_ID, accessKey),
  },
  {
    name: 'orders.settleTabCash',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => settleTabCash(SITE_ID, TAB_ID, accessKey),
  },
  {
    name: 'orders.discardTab',
    kind: 'action',
    gate: 'token-or-session',
    invoke: (accessKey?) => discardTab(SITE_ID, TAB_ID, accessKey),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // restaurant-token-or-session: restaurants/[id]/orders/actions.ts —
  // guarded by verifyRestaurantAccess (same 'all'/'manage_site' resource
  // vocabulary as verifySiteAccess, but ownership linkage is
  // restaurant.partnerAccountId, not site.userId)
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'restaurant-orders.setRestaurantOrderStatus',
    kind: 'action',
    gate: 'restaurant-token-or-session',
    invoke: (accessKey?) => setRestaurantOrderStatus(RESTAURANT_ID, ORDER_ID, 'accepted', undefined, accessKey),
  },
  {
    name: 'restaurant-orders.getRestaurantOrders',
    kind: 'action',
    gate: 'restaurant-token-or-session',
    invoke: (accessKey?) => getRestaurantOrders(RESTAURANT_ID, 'incoming', accessKey),
  },
  {
    name: 'restaurant-orders.getRestaurantOpenTabs',
    kind: 'action',
    gate: 'restaurant-token-or-session',
    invoke: (accessKey?) => getRestaurantOpenTabs(RESTAURANT_ID, accessKey),
  },
  {
    name: 'restaurant-orders.settleRestaurantTabCash',
    kind: 'action',
    gate: 'restaurant-token-or-session',
    invoke: (accessKey?) => settleRestaurantTabCash(RESTAURANT_ID, TAB_ID, accessKey),
  },
  {
    name: 'restaurant-orders.discardRestaurantTab',
    kind: 'action',
    gate: 'restaurant-token-or-session',
    invoke: (accessKey?) => discardRestaurantTab(RESTAURANT_ID, TAB_ID, accessKey),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // session-owner: actions that use requireSiteOwner (no token path)
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'site-actions.deleteSite',
    kind: 'action',
    gate: 'session-owner',
    // deleteSite uses requireSiteOwner internally; we pass the siteId
    invoke: (_accessKey?) => deleteSite(SITE_ID),
  },
  {
    name: 'site-actions.setPaymentProvider',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => setPaymentProvider(SITE_ID, 'mollie'),
  },
  {
    name: 'site-actions.saveGeneral',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) =>
      saveGeneral({
        id: SITE_ID,
        name: 'Test Beach',
        type: 'paid',
        price: '25',
        vat: '24',
        locationLat: '60.1699',
        locationLng: '24.9384',
      }),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // session-owner: calendar/actions.ts
  // Manual auth() + site.userId ownership check (no requireSiteOwner helper)
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'calendar.createPartnerReservation',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) =>
      createPartnerReservation({
        siteId: SITE_ID,
        itemIds: [ITEM_ID],
        from: '2025-07-01',
        to: '2025-07-07',
        paymentType: 'cash',
      }),
  },
  {
    name: 'calendar.getAvailableSunbeds',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) =>
      getAvailableSunbeds(SITE_ID, '2025-07-01', '2025-07-07'),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // session-owner: sites/[id]/inventory-actions.ts
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'inventory-actions.createInventoryItem',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => createInventoryItem({ siteId: SITE_ID }),
  },
  {
    name: 'inventory-actions.deleteInventoryItem',
    kind: 'action',
    gate: 'session-owner',
    // deleteInventoryItem fetches item by id; item stub in beforeEach provides siteId+ownership
    invoke: (_accessKey?) => deleteInventoryItem(ITEM_ID),
  },
  {
    name: 'inventory-actions.saveInventoryItemLocation',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) =>
      saveInventoryItemLocation(ITEM_ID, { locationLat: '60.1', locationLng: '24.9' }),
  },
  {
    name: 'inventory-actions.saveInventoryItemSchematicLocation',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => saveInventoryItemSchematicLocation(ITEM_ID, 100, 200),
  },
  {
    name: 'inventory-actions.saveInventoryItemProperties',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) =>
      saveInventoryItemProperties(ITEM_ID, { category: 'sunbed' }),
  },
  {
    name: 'inventory-actions.pairInventoryItems',
    kind: 'action',
    gate: 'session-owner',
    // pairInventoryItems fetches both items; second item stub uses findUnique returning owned item
    invoke: (_accessKey?) => pairInventoryItems(ITEM_ID, 'matrix-item-2'),
  },
  {
    name: 'inventory-actions.depairInventoryItem',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => depairInventoryItem(ITEM_ID),
  },
  {
    name: 'inventory-actions.deleteItemsByGroup',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => deleteItemsByGroup(SITE_ID, 1),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // session-owner: sites/[id]/inventory/actions.ts
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'inventory.syncChairsWithLayout',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) =>
      syncChairsWithLayout(
        SITE_ID,
        {
          group: 1,
          rows: 1,
          seatsPerRow: 2,
          baseLat: 60.1,
          baseLng: 24.9,
          horizontalGap: 2.5,
          verticalGap: 2.5,
          intraPairGap: 0.3,
          rotation: 0,
          price: 25,
          category: 'sunbed',
          pairSeats: false,
        },
        'create',
      ),
  },
  {
    name: 'inventory.getItemGroup',
    kind: 'action',
    gate: 'session-owner',
    // getItemGroup throws Error instead of returning {status:'error'};
    // normaliseThrow converts thrown errors to the standard shape for the matrix.
    invoke: (_accessKey?) =>
      normaliseThrow(() => getItemGroup(ITEM_GROUP_ID)),
  },
  {
    name: 'inventory.moveParcel',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => moveParcel(SITE_ID, 1, 36.7213, -4.4214),
  },
  {
    name: 'inventory.moveItems',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => moveItems(SITE_ID, [ITEM_ID], 0.001, 0.001),
  },
  {
    name: 'inventory.setItemStatusByGroup',
    kind: 'action',
    gate: 'session-owner',
    // setItemStatusByGroup throws Error instead of returning {status:'error'};
    // normaliseThrow converts thrown errors to the standard shape for the matrix.
    invoke: (_accessKey?) =>
      normaliseThrow(() => setItemStatusByGroup(ITEM_GROUP_ID, 'active')),
  },
  {
    name: 'inventory.rotateSelection',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => rotateSelection(SITE_ID, [ITEM_ID], 45),
  },
  {
    name: 'inventory.adjustItemSpacing',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) =>
      adjustItemSpacing(SITE_ID, [ITEM_ID, 'matrix-item-2'], 'horizontal', 1.2),
  },
  {
    name: 'inventory.assignItemsToGroup',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => assignItemsToGroup(SITE_ID, [ITEM_ID], 1),
  },
  {
    name: 'inventory.removeItemsFromGroup',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => removeItemsFromGroup(SITE_ID, [ITEM_ID]),
  },
  {
    name: 'inventory.reverseParcelNumbering',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => reverseParcelNumbering(SITE_ID, 1),
  },
  {
    name: 'inventory.reverseParcelOrientation',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => reverseParcelOrientation(SITE_ID, 1),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // session-owner: sites/[id]/rentals/actions.ts
  // All use requireSiteOwner
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'rentals.setRentalPaymentType',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => setRentalPaymentType(SITE_ID, 'online'),
  },
  {
    name: 'rentals.getRentalItems',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => getRentalItems(SITE_ID),
  },
  {
    name: 'rentals.createRentalItem',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) =>
      createRentalItem({
        siteId: SITE_ID,
        name: 'Kayak',
        totalQuantity: 5,
        pricePerHour: 10,
      }),
  },
  {
    name: 'rentals.updateRentalItem',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) =>
      updateRentalItem({
        id: RENTAL_ITEM_ID,
        siteId: SITE_ID,
        name: 'Kayak',
        totalQuantity: 5,
        pricePerHour: 10,
        active: true,
      }),
  },
  {
    name: 'rentals.deleteRentalItem',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => deleteRentalItem(SITE_ID, RENTAL_ITEM_ID),
  },
  {
    name: 'rentals.saveRentalVat',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => saveRentalVat(SITE_ID, '10'),
  },
  {
    name: 'rentals.toggleSiteFeature',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => toggleSiteFeature(SITE_ID, 'rentals', true),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // session-owner: sites/[id]/working-hours-actions.ts
  // addWorkingHours uses requireSiteOwner; update/delete use manual auth() check
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'working-hours.addWorkingHours',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) =>
      addWorkingHours(SITE_ID, { day: '1', openTime: '08:00', closeTime: '20:00' }),
  },
  {
    name: 'working-hours.updateWorkingHours',
    kind: 'action',
    gate: 'session-owner',
    // updateWorkingHours fetches by working-hours id; stub set in beforeEach
    invoke: (_accessKey?) =>
      updateWorkingHours(WORKING_HOURS_ID, { openTime: '09:00', closeTime: '21:00' }),
  },
  {
    name: 'working-hours.deleteWorkingHours',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => deleteWorkingHours(WORKING_HOURS_ID),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // session-owner: sites/[id]/content-actions.ts
  // Both use requireSiteOwner. uploadContentImage calls @vercel/blob put() —
  // mocked at test file level (vi.mock('@vercel/blob')).
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'content.saveContentFields',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) =>
      saveContentFields({ id: SITE_ID, description: 'A nice beach.', services: [] }),
  },
  {
    name: 'content.uploadContentImage',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => {
      const fd = new FormData()
      const blob = new Blob(['fake-image-data'], { type: 'image/jpeg' })
      const file = new File([blob], 'test.jpg', { type: 'image/jpeg' })
      fd.set('image', file)
      return uploadContentImage(SITE_ID, fd)
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // session-owner: sites/[id]/products/actions.ts
  // Some use requireSiteOwner; updateProduct/deleteProduct/updateProductImage/
  // products-version toggleProductSoldOut use manual auth() + product ownership.
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'products.toggleAppSales',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => toggleAppSales(SITE_ID, true),
  },
  {
    name: 'products.setOrderPaymentType',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => setOrderPaymentType(SITE_ID, 'online'),
  },
  {
    name: 'products.addProduct',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => {
      const fd = new FormData()
      fd.set('siteId', SITE_ID)
      fd.set('name', 'Test Product')
      fd.set('totalPrice', '10')
      fd.set('tax', '0')
      fd.set('category', 'food')
      return addProduct(fd)
    },
  },
  {
    name: 'products.updateProduct',
    kind: 'action',
    gate: 'session-owner',
    // updateProduct looks up product by id and checks product.site.userId
    invoke: (_accessKey?) =>
      updateProduct(PRODUCT_ID, { name: 'Updated' }),
  },
  {
    name: 'products.updateProductImage',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => {
      const fd = new FormData()
      const blob = new Blob(['fake-img'], { type: 'image/jpeg' })
      const file = new File([blob], 'product.jpg', { type: 'image/jpeg' })
      fd.set('image', file)
      return updateProductImage(PRODUCT_ID, fd)
    },
  },
  {
    name: 'products.deleteProduct',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => deleteProduct(PRODUCT_ID),
  },
  {
    name: 'products.toggleProductSoldOut',
    kind: 'action',
    gate: 'session-owner',
    // This is the products-version (takes id only), distinct from orders-version
    // (which takes siteId, productId, soldOut, accessKey).
    invoke: (_accessKey?) => productsToggleProductSoldOut(PRODUCT_ID, true),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // session-owner: sites/[id]/schematic/actions.ts
  // All use requireSiteOwner. updateLayoutElement / deleteLayoutElement fetch
  // the element first to resolve siteId, then call requireSiteOwner.
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'schematic.createLayoutElement',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) =>
      createLayoutElement(SITE_ID, {
        type: 'zone',
        shape: 'rect',
        x: 10,
        y: 10,
        width: 50,
        height: 30,
      }),
  },
  {
    name: 'schematic.updateLayoutElement',
    kind: 'action',
    gate: 'session-owner',
    // updateLayoutElement does layoutElement.findUnique first to get siteId
    invoke: (_accessKey?) =>
      updateLayoutElement(LAYOUT_ELEMENT_ID, { x: 20 }),
  },
  {
    name: 'schematic.deleteLayoutElement',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => deleteLayoutElement(LAYOUT_ELEMENT_ID),
  },
  {
    name: 'schematic.reorderLayoutElements',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) =>
      reorderLayoutElements(SITE_ID, [{ id: LAYOUT_ELEMENT_ID, z: 1 }]),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // session-owner: site-actions.ts remaining
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'site-actions.saveLayoutDimensions',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => saveLayoutDimensions(SITE_ID, 50, 30),
  },
  {
    name: 'site-actions.setSiteStatus',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => setSiteStatus(SITE_ID, 'active'),
  },
  {
    name: 'site-actions.saveBrand',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) =>
      saveBrand({
        siteId: SITE_ID,
        brandName: 'Sunny Beach',
        slug: 'sunny-beach',
        tagline: 'Relax.',
        bgColor: '#ffffff',
        fgColor: '#000000',
      }),
  },
  {
    name: 'site-actions.submitForm',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => {
      const fd = new FormData()
      fd.set('id', SITE_ID)
      fd.set('name', 'Test Beach')
      fd.set('locationLat', '60.1699')
      fd.set('locationLng', '24.9384')
      return submitForm({ status: 'ok' }, fd)
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // session-owner: sites/create/actions.ts
  // uploadSiteImage uses requireSiteOwner.
  // createSite: session-auth-only (no ownership check — the user IS creating the
  // site, so non-owner=ok is correct behaviour, not a bug). Excluded from the
  // matrix; covered by create/actions.test.ts instead.
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'create.uploadSiteImage',
    kind: 'action',
    gate: 'session-owner',
    invoke: (_accessKey?) => {
      const fd = new FormData()
      const blob = new Blob(['fake-img'], { type: 'image/jpeg' })
      const file = new File([blob], 'site.jpg', { type: 'image/jpeg' })
      fd.set('image', file)
      return uploadSiteImage(SITE_ID, fd)
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // restaurant-owner: restaurants/[id]/actions.ts
  //
  // Gate: requireRestaurantOwnerWithFlag(restaurantId, 'restaurants')
  //   → isFlagEnabled('restaurants') checked FIRST (must be true — enabled
  //     globally in auth-matrix.test.ts via vi.mock('@/app/flags'))
  //   → requireRestaurantOwner(restaurantId): checks restaurant.partnerAccountId
  //     === session.user.id
  //
  // createRestaurant: DUAL-PATHED. With siteId → requireSiteOwnerWithFlag (site-
  //   owner gate). Without siteId → flag + auth only (no ownership). Neither path
  //   is pure restaurant-owner. Registered as session-owner (siteId path) so the
  //   existing session-owner mocks apply cleanly.
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'restaurant-actions.createRestaurant',
    kind: 'action',
    gate: 'session-owner',
    // Uses siteId path → requireSiteOwnerWithFlag → site ownership check.
    // Registered as session-owner (not restaurant-owner) because this path gates
    // on SITE ownership, not restaurant ownership. The matrix site stubs in
    // beforeEach provide the needed downstream mocks (prisma.site.findUnique, etc.).
    invoke: (_accessKey?) => createRestaurant({ siteId: SITE_ID, name: 'Test Restaurant' }),
  },
  {
    name: 'restaurant-actions.updateRestaurantSettings',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      updateRestaurantSettings(RESTAURANT_ID, { name: 'Updated Name' }),
  },
  {
    name: 'restaurant-actions.setRestaurantOpeningHours',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      setRestaurantOpeningHours(RESTAURANT_ID, [
        { day: 1, openTime: '10:00', closeTime: '22:00' },
      ]),
  },
  {
    name: 'restaurant-actions.setRestaurantServiceShifts',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      setRestaurantServiceShifts(RESTAURANT_ID, []),
  },
  {
    name: 'restaurant-actions.createRestaurantCombination',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      createRestaurantCombination(RESTAURANT_ID, { capacity: 8, tableIds: [TABLE_ID] }),
  },
  {
    name: 'restaurant-actions.updateRestaurantCombination',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      updateRestaurantCombination(RESTAURANT_ID, COMBINATION_ID, { capacity: 10 }),
  },
  {
    name: 'restaurant-actions.deleteRestaurantCombination',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      deleteRestaurantCombination(RESTAURANT_ID, COMBINATION_ID),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // restaurant-owner: restaurants/[id]/menu/actions.ts
  // All use requireRestaurantOwnerWithFlag(restaurantId, 'restaurants')
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'restaurant-menu.createMenuItemForRestaurant',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) => {
      const fd = new FormData()
      fd.set('name', 'Grilled Fish')
      fd.set('price', '18.50')
      fd.set('category', 'main')
      return createMenuItemForRestaurant(RESTAURANT_ID, fd)
    },
  },
  {
    name: 'restaurant-menu.updateMenuItemForRestaurant',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) => {
      const fd = new FormData()
      fd.set('name', 'Updated Fish')
      return updateMenuItemForRestaurant(RESTAURANT_ID, MENU_ITEM_ID, fd)
    },
  },
  {
    name: 'restaurant-menu.archiveMenuItemForRestaurant',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      archiveMenuItemForRestaurant(RESTAURANT_ID, MENU_ITEM_ID),
  },
  {
    name: 'restaurant-menu.setMenuItemSoldOutForRestaurant',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      setMenuItemSoldOutForRestaurant(RESTAURANT_ID, MENU_ITEM_ID, true),
  },
  {
    name: 'restaurant-menu.reorderMenuItemsForRestaurant',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      reorderMenuItemsForRestaurant(RESTAURANT_ID, [MENU_ITEM_ID]),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // restaurant-owner: restaurants/[id]/reservations/actions.ts
  //
  // All use requireRestaurantOwnerWithFlag at the partner layer (restaurant-level
  // gate). The core functions (markSeated, markDeparted, etc.) re-check ownership
  // via requireStaffOwner(reservationId) which queries tableReservation.restaurant
  // .partnerAccountId — requires tableReservation stub.
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'restaurant-reservations.getRestaurantReservationsForDay',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      getRestaurantReservationsForDay(RESTAURANT_ID, '2025-07-01'),
  },
  {
    name: 'restaurant-reservations.markRestaurantReservationSeated',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      markRestaurantReservationSeated(RESTAURANT_ID, TABLE_RES_ID),
  },
  {
    name: 'restaurant-reservations.markRestaurantReservationDeparted',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      markRestaurantReservationDeparted(RESTAURANT_ID, TABLE_RES_ID),
  },
  {
    name: 'restaurant-reservations.markRestaurantReservationNoShow',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      markRestaurantReservationNoShow(RESTAURANT_ID, TABLE_RES_ID),
  },
  {
    name: 'restaurant-reservations.cancelRestaurantReservation',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      cancelRestaurantReservation(RESTAURANT_ID, TABLE_RES_ID),
  },
  {
    name: 'restaurant-reservations.setRestaurantReservationNotes',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      setRestaurantReservationNotes(RESTAURANT_ID, TABLE_RES_ID, 'VIP guest'),
  },
  {
    name: 'restaurant-reservations.modifyRestaurantReservation',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      modifyRestaurantReservation(RESTAURANT_ID, TABLE_RES_ID, { partySize: 3 }),
  },
  {
    name: 'restaurant-reservations.chargeRestaurantReservationDeposit',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      chargeRestaurantReservationDeposit(RESTAURANT_ID, TABLE_RES_ID),
  },
  {
    name: 'restaurant-reservations.getRestaurantWaitlistForDay',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      getRestaurantWaitlistForDay(RESTAURANT_ID, '2025-07-01'),
  },
  {
    name: 'restaurant-reservations.removeRestaurantWaitlistEntry',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      removeRestaurantWaitlistEntry(RESTAURANT_ID, WAITLIST_ENTRY_ID),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // restaurant-owner: restaurants/[id]/tables/actions.ts
  //
  // All use requireRestaurantOwnerWithFlag at the partner layer. The core
  // functions (createTable, updateTable, etc.) re-check ownership via
  // requireRestaurantOwner(restaurantId) — requires restaurant stub.
  // updateTableForRestaurant / duplicateTableForRestaurant / deleteTableForRestaurant:
  //   core looks up the table by tableId first, then checks restaurant ownership.
  //   Requires table stub with restaurantId.
  // updateElementForRestaurant / deleteElementForRestaurant:
  //   core looks up layoutElement by id, checks restaurantId, then checks ownership.
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'restaurant-tables.createTableForRestaurant',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      createTableForRestaurant(RESTAURANT_ID, { x: 5, y: 5 }),
  },
  {
    name: 'restaurant-tables.updateTableForRestaurant',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      updateTableForRestaurant(RESTAURANT_ID, TABLE_ID, { capacity: 6 }),
  },
  {
    name: 'restaurant-tables.duplicateTableForRestaurant',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      duplicateTableForRestaurant(RESTAURANT_ID, TABLE_ID),
  },
  {
    name: 'restaurant-tables.deleteTableForRestaurant',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      deleteTableForRestaurant(RESTAURANT_ID, TABLE_ID),
  },
  {
    name: 'restaurant-tables.createElementForRestaurant',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      createElementForRestaurant(RESTAURANT_ID, {
        type: 'wall',
        shape: 'rect',
        x: 0,
        y: 0,
        width: 10,
        height: 1,
      }),
  },
  {
    name: 'restaurant-tables.updateElementForRestaurant',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      updateElementForRestaurant(RESTAURANT_ID, RESTAURANT_ELEMENT_ID, { x: 1 }),
  },
  {
    name: 'restaurant-tables.deleteElementForRestaurant',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      deleteElementForRestaurant(RESTAURANT_ID, RESTAURANT_ELEMENT_ID),
  },
  {
    name: 'restaurant-tables.saveRestaurantCanvasDimensions',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      saveRestaurantCanvasDimensions(RESTAURANT_ID, 20, 15),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // restaurant-owner: restaurants/[id]/accounting/actions.ts (dine-in v2 Phase 6)
  // Session-only (no token path) — requireRestaurantOwnerWithFlag, same gate
  // class as every other restaurant-settings action above.
  // ══════════════════════════════════════════════════════════════════════════

  {
    name: 'restaurant-accounting.getRestaurantTabInvoicesByMonth',
    kind: 'action',
    gate: 'restaurant-owner',
    invoke: (_accessKey?) =>
      getRestaurantTabInvoicesByMonth(RESTAURANT_ID, 1, 2026),
  },
]
