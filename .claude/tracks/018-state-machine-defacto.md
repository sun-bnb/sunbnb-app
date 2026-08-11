# Reservation state machine — de facto extraction (track 018, P0)

Extracted 2026-08-11 from code, not docs. Every claim carries a `file:line` anchor.
Scope: **sunbed reservations** (rental bookings / table reservations are parallel machines,
out of scope per Q5). This documents what the code DOES — divergences from what it plausibly
SHOULD do are collected at the bottom (D-list) and feed the P1 intended-model design.

## 1. The compound state — what "state" actually is

A bed's state is derived at read time from **seven components**. No single column holds it.

| # | Component | Storage | Values / shape |
|---|-----------|---------|----------------|
| C1 | Payment status | `Reservation.status` (String) | pending, processing, complete, paid-in-cash, held, payment_failed (+legacy 'error'), canceled, refunded (`reservation-status.ts:65`) |
| C2 | Operational status (whole-stay, legacy) | `Reservation.operationalStatus` | expected, checked-in, walked-in, departed, no-show, comp, **'blocked'** (raw string, not an OP_ constant) — default 'expected' (`schema.prisma:400`) |
| C3 | Today's operational status | `ReservationDay.operationalStatus` (per civil date, venue TZ) | same values; row created lazily; **never created for blocked** (`reservation-day.ts:66`) |
| C4 | Stay-over | computed server-side (`stayOver` prop) | true ⇔ no reserved days remain after today |
| C5 | Cash evidence ("settled") | non-voided `TillEntry` rows linked by `reservationId` | `settled = tillEntries.length > 0` (`BedDetail.tsx:263`, `bed-state.ts:108`) |
| C6 | Payment ref / refund | `paymentRef` (`tr_…` Mollie, `pi_demo_…`, null), `refundedAt` | drives Mollie-paid detection (`BedDetail.tsx:320`) and refund idempotency (`actions.ts:1945`) |
| C7 | Comp flag | `isComp` (durable, survives lifecycle) | analytics source of truth (`reservation-status.ts:139`) |

**Effective op status** (read side): `today?.operationalStatus ?? operationalStatus`, except
blocked which always reads the parent (`bed-state.ts:36-39`). **Write side**:
`applyDayTransition` writes today's row AND mirrors onto the parent in one tx
(`reservation-day.ts:145-209`) — the two stay equal only while every writer goes through it
(they don't all — D9).

**Grid derivation** (`bed-state.ts`): released ⇔ (departed|no-show) ∧ stayOver
(`bed-state.ts:50-53`); active reservation = first non-released, preferring non-failed
(`:64-70`); BedState ∈ {available, expected, checked-in, walked-in, blocked, comp}; departed/
no-show mid-stay renders 'expected' (`:84`). Payment glyph precedence: complete → 'card',
settled → '€', else none (`:105-110`).

**Availability derivation** (`packages/data/src/reservations.ts:120-142`,
`findConflictingReservation`): blocking ⇔ status ∈ BLOCKING_STATUSES (pending, processing,
complete, paid-in-cash, held) ∧ NOT(op ∈ {departed, no-show} ∧ `to <= endOfToday`). Uses the
**parent** op status and **server-TZ** endOfToday — not the today-row, not venue TZ (D8).

## 2. The de facto kinds (status × op × flags discriminate seven entity kinds)

C1 alone does not identify what a reservation *is* — `paid-in-cash` is overloaded across
four kinds. The real discriminator is the (C1, C2, C7) tuple:

| Kind | status | op | other | Created by |
|------|--------|----|----|-----------|
| K1 Online booking | pending→processing→complete | expected→checked-in→departed (daily cycle) | paymentRef | consumer app (`apps/user/.../actions.ts:138`: paid site → pending, free site → **complete directly**) |
| K2 Cash walk-in | paid-in-cash | walked-in (↔expected between days) | settled variant: TillEntry + receipt invoice | reserveItem/reserveItems (`actions.ts:317-349,1355-1386`) |
| K3 QR-collected walk-in | paid-in-cash→processing→complete | walked-in (unchanged) | paymentRef, anonId minted | collectReservationPayment (`actions.ts:2201`) |
| K4 Hold | held | expected | paymentAmount 0 | holdBed/holdBeds (`actions.ts:1243,1408`) |
| K5 Comp | paid-in-cash | comp | isComp, paymentAmount 0 | compBed/compBeds (`actions.ts:1118,1530`) |
| K6 Block | paid-in-cash | 'blocked' | `to` = 2999-sentinel (`actions.ts:134`), no day-row ever | blockBed/blockBeds (`actions.ts:996,1474`) |
| K7 Failed | payment_failed / 'error' | (any) | | Mollie create failure (`reservation-payment.ts:219`), webhook/poll/reconcile |

## 3. De facto transition inventory

Format: **event** (actor) — guard → writes ⟶ side effects. All partner actions also gate on
`verifySiteOwnership` and end with `revalidatePath`; omitted below.

### K1 Online booking
- **create** (consumer, `saveReservationForMultipleItems`) — conflict guard → create
  status=pending|complete (site.type), op defaults 'expected', DB-priced paymentAmount.
- **initiate payment** (consumer / partner-collect, `createReservationMolliePayment`) —
  → processing + paymentRef (`reservation-payment.ts:240`); provider error → payment_failed
  (`:219`).
- **confirm** (webhook / GET poll / reconcile / partner collect-poll, all via
  `processConfirmedReservation`) — idempotent invoices (PARTNER+PLATFORM) → status=complete
  (skipped when `skipCommission` — cash receipts don't advance status, `payment.ts:762-768`)
  ⟶ confirmation email (unless skipEmail).
- **fail** (webhook `apps/user/.../mollie/route.ts:150-155`, poll, reconcile) — collect
  payments (metadata `collect`) revert → paid-in-cash + paymentRef=null; else →
  payment_failed.
- **refund webhook** — → refunded (`route.ts:193`).
- **check-in** (partner) — guard today-row ?? parent == expected → applyDayTransition
  (checked-in, checkedInAt) (`actions.ts:480-513`).
- **depart** (partner, whole) — guard eff ∈ {checked-in, walked-in}; future days →
  applyDayTransition(expected, nulls) else (departed, departedAt) (`actions.ts:766-787`).
- **no-show** (partner) — guard eff == expected → applyDayTransition(no-show)
  (`actions.ts:795-826`).
- **refund** (partner, `refundReservation`) — status==complete, idempotent on refundedAt →
  Mollie refund, stamp refundedAt ONLY (bed stays occupied) (`actions.ts:1920-1966`).
- **cancel** (partner) — status==complete → status = refundedAt ? refunded : canceled;
  row kept for audit (`actions.ts:1984-2034`). **cancel** (user side) — ownership → refund
  via provider if paid → status=canceled (whole reservation).
- **move** (partner, both variants) — parent op ∉ {no-show, departed} → re-point items via
  conflict-guarded tx; identity/payment/invoices preserved (`actions.ts:858-992`).

### K2 Cash walk-in
- **create** (reserveItem: pair/group-expanded; reserveItems: exact ids) — conflict guard →
  paid-in-cash + walked-in + checkedInAt + DB-priced paymentAmount ⟶ if
  `recordCashSettlement` ∧ paid site ∧ amount>0: TillEntry + PARTNER-only receipt invoice
  (`actions.ts:341-349`). Card variant books UNSETTLED then enters K3.
- **settle** (`settleReservation`) — status==paid-in-cash ∧ op(parent!) ∈ {walked-in,
  expected}; staff-entered amount (0<a≤100k) ⟶ TillEntry + receipt (`actions.ts:2137-2186`).
- **depart whole** — as K1 depart; **money stays** (no till writes).
- **depart split subset** (`markDeparted(splitItemIds)`, cash+walked-in only) — one tx:
  disconnect subset, original.paymentAmount=remaining; create NEW reservation (subset amount,
  copies attribution); depart new one (future days → expected) (`actions.ts:652-764`).
  **TillEntry + receipt NOT split/moved** (D1).
- **resume** (`resumeWalkIn`, between-days leg) — eff==expected → applyDayTransition
  (walked-in, checkedInAt=now) (`actions.ts:530-560`).
- **unreserve** (Group) — match status==paid-in-cash, ANY op, overlap-today → void
  TillEntries BEFORE deleteMany (FK SetNull) → DELETE (`actions.ts:369-404`).
  **unreserve** (Seat, >1 items) — disconnect item + paymentAmount=remaining; **never voids**
  (`actions.ts:434-459`). (Seat, ==1 item) — void (if flag) + delete.
- **split seat for collect** (`splitWalkInSeat`) — cash ∧ walked-in ∧ >1 items → tx
  disconnect + create single-seat walk-in (per-seat amount) (`actions.ts:2442-2544`).
  Same till/receipt non-conservation as depart-split (D1).
- **GC** (cleanup cron) — paid-in-cash|held ∧ createdAt < server-day-start ∧ to < now →
  **deleteMany** (`reservations-cleanup/route.ts:56-64`). Deletion is the normal end-of-life
  for cash rows; durable audit lives only in TillEntry (SetNull) + receipt Invoice (SetNull).

### K3 QR-collect (walk-in → online payment)
- **start** (`collectReservationPayment`) — guard op==walked-in ∧ status==paid-in-cash ∧
  paid site (**does NOT check settled/TillEntry** — D6); recompute + OVERWRITE paymentAmount;
  mint anonId; demo → paymentRef=pi_demo_+processing; real → Mollie create → processing;
  create-error → revert paid-in-cash (`actions.ts:2201-2296`).
- **poll** (`getCollectStatus`) — processing+ref → reverifyAndFinalize: paid →
  processConfirmedReservation → complete; failed → revert paid-in-cash+ref=null
  (`actions.ts:2305-2344`).
- **abandon** (`cancelCollection`) — processing only; reverify once (paid → complete);
  Mollie cancel confirmed → **void settlements + DELETE reservation** ('freed',
  `actions.ts:2386-2397`); cancel uncertain → revert paid-in-cash (never delete)
  (`:2410-2419`). Deleting frees an occupied seat on the collect-on-seated-guest and
  seat-split paths (D5).
- **webhook fail during collect** — reverts to paid-in-cash (metadata.collect guard).
- Cron protection: pending/processing sweep skips op ∈ {walked-in, checked-in}
  (`reservations-cleanup/route.ts:50`).

### K4 Hold
- **create** hold(s) — held + expected + amount 0; today-only unless `until`.
- **convert to walk-in** (`convertHoldToWalkIn`, 4 sub-paths `actions.ts:1600-1891`):
  today-only whole → **in-place update** to paid-in-cash+walked-in+checkedInAt+amount
  (⟶ optional TillEntry+receipt); today-only subset (Seat scope) → disconnect subset +
  create walk-in; extended (`until` past today) whole → tx re-check conflicts + in-place
  update; extended subset → tx disconnect + create. In-place paths write the PARENT only —
  today-row syncs lazily on next render via `resolveTodayRow` presentState update
  (`reservation-day.ts:107-112`) (D9).
- **release** — deleteMany (Group) / disconnect-or-delete (Seat) (`actions.ts:2043-2095`).
- **check-in / no-show**: holds are op=expected so K1's transitions ALSO match them
  (checkInReservation flips a held row to checked-in without payment — no status guard).
- **GC** — same cron sweep as K2.

### K5 Comp / K6 Block
- **create** — see table §2; block conflict window is [today, ∞) via sentinel `to`.
- **end** (uncompBed / unblockBed) — deleteMany (Group) / disconnect-or-delete (Seat)
  (`actions.ts:1053-1105,1177-1227`). No till/invoice involvement (amount 0).
- Block: sticky (cron never matches `to`=2999); no day-row ever; parent op is the only truth.

### K7 Failed
- **remove** (`removeFailedReservation`) — status ∈ {payment_failed, 'error'} → delete
  (`actions.ts:3463-3492`). **GC** — cron: payment_failed older than 24h; pending/processing
  older than 15min (unless walked-in/checked-in).

## 4. Divergences (D-list) — de facto ≠ coherent model

- **D1 (=B1, founder repro).** All three split paths (depart-split `actions.ts:687-716`,
  collect-split `:2508-2540`, hold-convert-splits) conserve `paymentAmount` but never split /
  re-link `TillEntry` or the receipt `Invoice`. Peeled reservation reads unsettled → UNPAID
  pill + Settle/Collect offered → double-charge; original's TillEntry amount ≠ its
  paymentAmount → Unreserve refund-voids the FULL original entry while the dialog shows the
  reduced amount; receipt invoice covers seats it no longer owns.
- **D2 (=B2).** Seat-mode unreserve: disconnect branch voids nothing (correct per comment)
  but the confirm dialog shows `confirmUnreserveRefund` with the WHOLE `paymentAmount`
  whenever settled (`BedDetail.tsx:401-404`) — claims cash left the till; nothing happened.
- **D3 (=B3).** Every cash-row delete (unreserve, cron GC, cancelCollection-freed) orphans
  the PARTNER receipt invoice (`Invoice.reservationId` has no onDelete → SetNull,
  `schema.prisma:573`); till voids but invoiced revenue stays. No credit-note path (Q4).
- **D4.** "Settled" is UI-derived only (C5). No status value distinguishes settled from
  unsettled cash walk-ins, so every action guard (settle, collect, unreserve) is blind to it
  unless it separately queries TillEntry — none do.
- **D5.** `cancelCollection` on confirmed Mollie cancel DELETES the reservation
  (`actions.ts:2386-2397`) — right for the book-with-card-then-abandon flow, wrong for
  collect-on-a-seated-guest and seat-split-collect (frees an occupied bed; guest's seat
  membership destroyed). Both its own docstring (`:2346-2353` "reverts to paid-in-cash") and
  `splitWalkInSeat`'s (`:2436-2438`) describe the OLD revert behavior — docs lie.
- **D6.** `collectReservationPayment` doesn't check settled state — a cash-SETTLED walk-in
  passes its guard (`actions.ts:2226-2228`); only the UI hides the button
  (`BedDetail.tsx:1261`). Stale client / race → cash till entry + full Mollie charge both
  recorded. Also unconditionally overwrites `paymentAmount` (`:2251-2254`), discarding any
  staff-adjusted Settle amount context.
- **D7.** `settleReservation` and `moveReservation` guard on the **parent** op status
  (`actions.ts:2170,884`); check-in/depart/no-show/resume guard on today-row ?? parent.
  Two different notions of "current state" in the same file.
- **D8.** Conflict guard's stay-over release uses parent op + **server-TZ** endOfToday
  (`reservations.ts:120-135`); grid release uses today-row + `stayOver` computed venue-local.
  Availability and grid can disagree exactly at day boundaries / TZ offsets (track 017 class;
  cron also uses server-TZ `dayjs().startOf('day')`, `reservations-cleanup/route.ts:37`).
- **D9.** In-place kind changes (hold→walk-in convert paths) write the parent only; today's
  ReservationDay row keeps 'expected' until a page render lazily syncs it
  (`reservation-day.ts:107-112`). Guards that read today-row first (e.g. `checkInReservation`
  eff==expected) can act on the STALE row in the gap — a just-converted walk-in can be
  "checked in" to blue, K1-style, without payment reconciliation.
- **D10.** `checkInReservation` / `markNoShow` have NO status guard — they match holds (K4)
  and even processing/pending rows, not just online bookings. Kind is not checked, only op.
- **D11.** K6 blocks are `status=paid-in-cash` (`actions.ts:1038`) — a payment status on a
  never-paid maintenance row; every revenue/analytics query must remember to exclude by op
  ('blocked') instead. 'blocked' itself is a raw string, absent from the OP_ constants.
- **D12.** Two cancel semantics: partner cancel keeps the row (audit, terminal
  canceled/refunded); unreserve/release/uncomp/unblock/cron DELETE rows. The kind determines
  which — but nothing in the model names this "audit-kept vs ephemeral" distinction; it's
  implicit in which action you call.
- **D13.** Entry-path-dependent grouping: `reserveItem` auto-expands pair/group siblings
  (`actions.ts:282-288`); `reserveItems` (bulk) takes exact ids. The same physical intent
  (seat a party) yields different reservation shapes depending on UI path — and splits then
  multiply the shapes further.
- **Doc drift:** `reserveItem`'s comment claims the Card/QR path "writes its own settled
  TillEntry on completion" (`actions.ts:337-340`) — no code in the confirm path writes
  TillEntry for card collects (till is cash-only per track 013). Glyph comes from
  status=complete, not a till row.

## 4b. Addendum (2026-08-11, found by the P2b single-writer scan)

The meta-guard scan (`packages/data/src/reservation-machine-guard.test.ts`) found two
writer files the P0 sweep missed:

- **D14 — `apps/partner/app/frontdesk/actions.ts`** (4 state writes): checkInReservation /
  markDeparted / markNoShow / cancelReservation duplicated at **pre-track-012 semantics** —
  parent-column writes only (NO ReservationDay row, no `applyDayTransition`), parent-only
  guards, no venue TZ, and depart is **unconditionally terminal** (no hasFutureDays branch —
  a multiday guest departed from the frontdesk loses the daily cycle). Cancel sets
  CANCELED with no refund coupling. This is the duplicate track 012 P3 predicted.
- **D15 — `apps/partner/app/reservations/[id]/actions.ts`** (4 state writes): the partner
  reservation-detail page carries its own transition set of the same shape (audit precisely
  at P4 migration).

Both are now ratcheted in the meta-guard ALLOWLIST and are P4 migration targets alongside
manage/actions.ts (19 sites), the user-app payment writers (8 across 5 files), and the
cleanup cron (1).

## 5. Raw material for P1 (intended-model design)

- The **kind** (K1–K7) is the real top-level state variable; C1 overloading (paid-in-cash
  ×4) is the root of most guard blindness. The intended model should name kinds explicitly.
- The per-day cycle applies only to K1/K2 multiday; K4/K5 are today-scoped; K6 is dateless.
- Side-effect ledger objects to conserve per transition: seats (items[]), `paymentAmount`,
  TillEntry rows, receipt/online invoices, paymentRef, anonId capability, day-rows.
- Events that must become table rows: create×7, initiate/confirm/fail/refund (payment),
  check-in, resume, depart(whole|split), no-show, settle, collect(start|poll|abandon),
  split-seat, convert(hold→walk-in ×4), unreserve(group|seat), release, uncomp, unblock,
  cancel(partner|user), refund, move(×2), remove-failed, GC(×3 sweeps).
- Guards must uniformly read ONE effective-state function (today-row semantics, venue TZ)
  — D7/D8/D9 all vanish if `deriveState` is the only reader and every kind-change transition
  writes the day-row through `applyDayTransition`.
