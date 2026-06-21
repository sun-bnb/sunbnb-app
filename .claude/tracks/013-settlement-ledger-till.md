# Track 013 — Settlement ledger (offline cash till source of truth)

**Status:** Building (P0) · **Surface:** `packages/data` + `apps/partner` · **Schema:** additive (new `TillEntry`)

## Goal

Make the per-worker till reliable by sourcing it from an explicit cash-settlement
**ledger** instead of deriving it from reservation operational status. Today
`getOpenTill` / `getTillByEmployee` sum `paid-in-cash` + **`walked-in`** reservation
`paymentAmount` — so a guest who paid cash then departed silently drops out of the
till, status corrections re-price it, and seat turnover (multiple customers per seat
per day) isn't captured. Replace that with an immutable ledger: an explicit **Settle**
event records cash taken; the till sums ledger entries, fully decoupled from occupancy.

This is the offline-payment-decoupling principle made literal (see
`memory/project_online_offline_reservation_flexibility`): the reservation is the
operational marker; the settlement is the money.

## Decisions (locked with the user, 2026-06-21)

- **Ledger table** (`TillEntry`), not reservation fields — audit, multiple/partial,
  corrections-as-rows. ("Settlement" is reserved by the monthly payout model.)
- **Settle = alternative to Collect payment** (cash vs card). Walk-in/check-in just
  **occupy**; payment is a separate explicit event. Settle → ledger (no invoice);
  Collect → Mollie + invoice.
- **Rename the seat-create verb**: **"Walk-in"** from an available seat, **"Check-in"**
  from a reserved/held seat. Drops "Rent" (also disambiguates from equipment *rentals*).
- **Settle button**: square, to the LEFT of "Collect payment" in the walked-in branch;
  editable amount prefilled from the DB price; attributed to the current worker.
- **Keep `status: paid-in-cash`** as the "offline/cash booking" marker; settled-ness
  lives in the ledger; grid paid-indicator = settled-or-collected.
- **Refund on unreserve**: unreserving a SETTLED offline reservation shows a
  **"money returned" checkbox, checked by default**. Checked → void the settlement
  (cash leaves the drawer); unchecked → keep it (forfeited / retained).
- **Rentals**: staged — sunbeds onto the ledger first; cash walk-in rentals keep their
  current `paymentAmount` till contribution during transition, move to the ledger later.
- Supersedes the recent `paymentAmount`-reduction till-conservation (refund now voids a
  settlement instead of editing `paymentAmount`).

## Roadmap

- ⏳ **P0 — Ledger + till re-point (ZERO behavior change).** New `TillEntry` model +
  additive migration with idempotent backfill (one settlement per existing
  `paid-in-cash` + `walked-in` reservation with `paymentAmount > 0`:
  amount=paymentAmount, employeeId, settledAt=createdAt). `@repo/data/till`:
  `recordSettlement` / `voidSettlement(sForReservation)` + re-point
  `getOpenTill`/`getTillByEmployee`/`getTillStatus` to sum the ledger (non-voided,
  in-window, by employee) for the reservation portion; rentals unchanged. **(P0a data,
  P0b partner: walk-in creation auto-records a settlement so the till is unchanged +
  update `apps/partner/__mocks__/@repo/data/till.ts`.)**
- **P1 — Decouple + Settle.** Walk-in/check-in stop auto-settling (occupy only); add
  `settleReservation` action (records a `TillEntry`, editable amount) + Settle button
  (square, left of Collect) + grid settled indicator. Labels: Rent → Walk-in / Check-in
  (single-seat + bulk).
- **P2 — Refund/void.** Unreserve of a settled walk-in: "money returned" checkbox
  (default checked) → `voidSettlementsForReservation`; wire into unreserve (single + bulk).
- **P3 — Rentals onto the ledger** (deferred).

## Resume here

**P0a DONE** (uncommitted) — `TillEntry` model + migration `20260621151602_add_till_entry_ledger`
(additive + idempotent backfill from existing `paid-in-cash`+`walked-in`+`amount>0`
reservations) + `recordSettlement`/`voidSettlementsForReservation` + till re-pointed onto
the ledger (rentals unchanged). 235 unit + 18 till integration green; client regenerated.

**Realization — no separate "auto-settle" step (old P0b dropped):** `reserveItems` never
wrote the till, and the till now reads the ledger, so **walk-ins already occupy-without-
settling**. The decoupling is automatic; the only thing missing is the explicit Settle UI.

**P1 DONE** (uncommitted) — `settleReservation` action (+ gated-actions), partner till
mock updated, Settle button (square 💵 left of Collect) + prefilled editable amount editor
→ `recordSettlement`, grid paid-indicator = settled-or-collected (`tillEntries` included in
page.tsx + `Reservation` type), labels Rent → Walk-in / Check-in (single + bulk). partner
1677 unit green, tsc/lint clean, settle unit + integration tests added.

**P2 DONE** (uncommitted) — `unreserveItem` gained `voidSettlements = true`; voids the
reservation's settlements (`voidSettlementsForReservation`) BEFORE delete on the whole-
reservation paths (never on a multi-seat disconnect). BedDetail unreserve confirm shows a
"money returned" checkbox (default checked) when the reservation is settled; unchecked →
cash retained (entry survives via `reservation_id` SetNull). Bulk free defaults to void
(money returned). 3 pre-existing till integration tests realigned to the new model
(walk-in occupies → till 0; settle → till reflects). partner 1682 unit + 156 integration
green, tsc/lint clean. The paymentAmount-reduction on disconnect/split was LEFT (it still
maintains the "expected price" prefill — no longer the till source, but not dead).

**VERIFIED** (browser, 2026-06-21) — Walk-in (renamed) → seat occupied/unpaid (no entry);
Settle 💵 (left of Collect) → "Cash received" editor prefilled+editable → confirm → active
`TillEntry` in DB; Unreserve → "Money returned" checkbox (checked default) → confirm →
settlement `voided_at` set + reservation deleted + entry survives via `reservation_id`
SetNull. Test data cleaned up. **READY TO COMMIT** (P0a+P1+P2, uncommitted — includes the
`TillEntry` migration). Then **P3** rentals onto the ledger (deferred).

**P3a DONE** (data) — `packages/data/src/till.ts` gained `TillEntry.rentalBookingId`,
`recordSettlement` generalized (accepts `rentalBookingId?`), `voidSettlementsForRentalBooking`
added; `getOpenTill`/`getTillByEmployee` re-sourced from ledger (no separate rentalBooking
aggregate). Cash rentals no longer reach the till until a `TillEntry` is recorded.

**P3b DONE** (2026-06-21) — `createWalkInRental` (manage/actions.ts) gained `recordCashSettlement?: boolean`.
Genuine cash path: `CreateRentalModal` passes `recordCashSettlement: true` → `recordSettlement`
called per booking (amount from guard inputs, never a literal). Card(QR) path: modal wires
`paymentType='cash'` but omits `recordCashSettlement` (defaults false) — no TillEntry,
preventing double-count when `collectRentalPayment` (Mollie) settles. Free bookings
(paymentAmount 0) skip settlement even if flag is set. `voidSettlementsForRentalBooking`
added to till mock so mock-contract guard passes. 1685 unit + 159 integration green,
tsc/lint clean. 3 new unit tests (cash/card/free) + 3 new integration tests (genuine-cash
TillEntry → till reflects; card path no entry; free no entry). **UNCOMMITTED.**

**Uncommitted footprint (P0a + P1 + P2 + P3a + P3b):** `packages/data` schema + migrations
`20260621151602_add_till_entry_ledger` + `20260621162554_add_till_entry_rental_booking`
+ `src/till.ts` + till tests; `apps/partner` actions (`createWalkInRental` + imports),
`CreateRentalModal.tsx` (recordCashSettlement wiring), till mock, unit tests, integration
tests. Schema migrations are additive; push to `main` gated on track-012 test-DB migration.

- **Context:** `packages/data/src/till.ts` owns all ledger helpers; `apps/partner/app/sites/[id]/manage/actions.ts` `createWalkInRental` is the entry point for rental cash settlement; `apps/partner/app/sites/[id]/manage/CreateRentalModal.tsx` is the UI that distinguishes cash vs card vs free.
- **Blocked by:** nothing (additive). Note: pushing `main` is already gated on the
  track-012 test-DB migration; this adds another additive migration to that queue.
