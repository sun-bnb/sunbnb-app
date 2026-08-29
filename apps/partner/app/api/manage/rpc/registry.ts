/**
 * RPC allowlist for the manage-floor HTTP surface (track 024 P6.5).
 *
 * The React Native floor app cannot call Next server actions (no public HTTP
 * contract), so `/api/manage/rpc` forwards a JSON `{ action, args }` body to
 * one of these functions and returns its result verbatim.
 *
 * SAFETY INVARIANT — do not weaken without re-reading this comment:
 * The route itself carries NO auth logic. Every function listed here already
 * takes a trailing/optional `accessKey` argument and verifies it server-side
 * (`verifySiteOwnership` / `verifySiteAdmin` inside `manage/actions.ts`) — that
 * is the ENTIRE reason forwarding is safe. Adding a function here that lacks
 * its own accessKey-verified gate would create a second, unguarded entry point
 * into that action, bypassing the existing auth-rejection matrix.
 *
 * Every key here is asserted (registry.gated-subset.test.ts) to have a
 * `manage.<key>` counterpart in `app/test/gated-actions.ts`, so the matrix's
 * auth-rejection coverage transfers to this surface automatically. If an
 * action isn't in the gated registry, either add it there first (see that
 * file's THROW-NORMALISATION note for the pattern) or leave it out of this
 * allowlist — never add it here alone.
 */

import {
  reserveItem,
  reserveItems,
  unreserveItem,
  checkInReservation,
  resumeWalkIn,
  markDeparted,
  markNoShow,
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
  splitWalkInSeat,
  removeFailedReservation,
  settleReservation,
  createPoolSeat,
  addSeatToGroup,
  removeGroupSeat,
  deletePoolSeat,
  collectReservationPayment,
  getCollectStatus,
  cancelCollection,
  collectRentalPayment,
  getRentalCollectStatus,
  cancelRentalCollection,
  createWalkInRental,
  markRentalPickedUp,
  markRentalReturned,
  findReservations,
  getTillStatus,
  closeTill,
  getOpenTillItems,
  getOpenTills,
  getTillDayReport,
  getDayShiftItems,
  closeDay,
  getManageTrends,
  getManageTrendsCsv,
} from '@/app/sites/[id]/manage/actions'

/** A registry entry: any function taking JSON-serializable args and returning a JSON-serializable value. */
export type RpcHandler = (...args: any[]) => Promise<unknown>

/**
 * Keyed by the plain (undomained) function name — the RPC caller sends
 * `{ action: 'reserveItem', args: [...] }`, not `manage.reserveItem`.
 */
export const RPC_ACTIONS: Record<string, RpcHandler> = {
  // ── Reservation / bed actions ──────────────────────────────────────────
  reserveItem,
  reserveItems,
  unreserveItem,
  checkInReservation,
  resumeWalkIn,
  markDeparted,
  markNoShow,
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
  splitWalkInSeat,
  removeFailedReservation,
  settleReservation,
  createPoolSeat,
  addSeatToGroup,
  removeGroupSeat,
  deletePoolSeat,

  // ── Collect triple (reservations + rentals) ────────────────────────────
  collectReservationPayment,
  getCollectStatus,
  cancelCollection,
  collectRentalPayment,
  getRentalCollectStatus,
  cancelRentalCollection,

  // ── Rentals ─────────────────────────────────────────────────────────────
  createWalkInRental,
  markRentalPickedUp,
  markRentalReturned,

  // ── Guest search ────────────────────────────────────────────────────────
  findReservations,

  // ── Till (admin-token-gated where noted in gated-actions.ts) ───────────
  getTillStatus,
  closeTill,
  getOpenTillItems,
  getOpenTills,
  getTillDayReport,
  getDayShiftItems,
  closeDay,

  // ── Trends (admin-token-gated) ──────────────────────────────────────────
  getManageTrends,
  getManageTrendsCsv,
}
