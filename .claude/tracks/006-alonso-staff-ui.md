---
id: 006-alonso-staff-ui
title: Alonso → Staff UI Migration
status: active
created: 2026-06-17
updated: 2026-06-17
worktree: null
---

## Goal

**Improve the partner on-site "manage" staff UI by borrowing the best parts of the Alonso Beach
app** — a real, in-the-field beach-rental floor app modelled in [[track:005-alonso-beach-model]].
Scope is **the staff/manage surface only** (`apps/partner/app/sites/[id]/manage/`): the live floor
map, walk-in/check-in flow, bed states, and equipment-rental ops. We are **not** replacing our UI
with Alonso's — we take the parts where Alonso is simpler/clearer and keep the parts where Sunbnb is
right (server-authoritative, multi-tenant, DB prices, scoped tokens — never import Alonso's
client-trusted / single-tenant / plaintext model; see [[track:005-alonso-beach-model]] anti-patterns).

**Why it matters.** Sunbnb has the hard half right (payments, invoicing, settlement, multi-tenancy)
but is **thin on the daily floor-operations layer** a real chiringuito lives in all day. Alonso is
ground-truth for that layer. Our manage page today is a single 47 KB monolith (`view.tsx`) stacking
a fat status bar + every parcel + rentals in one scroll; it's heavier than the job needs.

**End state.** A decomposed manage surface with (1) a **thin toolbar** replacing the fat status
summary bar, (2) a **top-level view switcher** showing **one parcel or the rentals view at a time**
(the Sections/Scroll mode toggle removed entirely), and (3) a **richer, clearer bed-state model**
borrowed from Alonso — a `gratis`/comp occupancy state, a cleaner out-of-service lifecycle
(`desactivada` vs today's ad-hoc block flag), and a lightweight same-day "hold" distinct from the
heavy payment-backed reservation — each landed as a vertical UI+data slice.

**Non-goals.** No consumer-app/user-app changes. No accounting-page rebuild (comps must be
*excluded* from revenue, but the daily-till / per-employee cash-close from Alonso is a separate
future effort, not this track). No realtime-socket transport swap (RTK polling stays). No theme
work in v1 (deferred). No copying Alonso code.

## Decisions taken (2026-06-17, with user)

- **Sequencing = interleave.** Not "all UI then all data." The shell (toolbar + switcher + kill
  sectioned view) ships first because it has zero data dependency; from there each borrowed state
  lands as a **vertical slice** (UI + `@repo/data` + migration-if-needed together).
- **View switcher replaces the Sections/Scroll toggle — sectioned rendering is removed entirely.**
  One parcel (or rentals) on screen at a time; within a view, scroll + zoom only. The
  `chunkDisplayColumns` / `computeChunkSize` / sectioned-grid path in `grid-helpers.ts` + `view.tsx`
  becomes dead code to delete.
- **Theme deferred.** Toolbar v1 = zoom controls + a compact occupancy readout + the view switcher.
  No dark/light toggle yet (bed colors are deliberately high-contrast for direct sun; revisit later
  as dark *chrome* only).

## Manage state machine — target design (P7, build deferred)

Settled with the user 2026-06-17. The manage bed model has **two orthogonal axes** — payment
`status` (was money taken, and through which channel) × `operationalStatus` (where in the
arrival lifecycle) — plus a **provenance** read off the payment status:

- **Online/QR paid** (`status=complete`, invoice exists) — the **baseline**, created by beachgoers
  in-system. Real platform money taken → **guarded**: it cannot be clobbered, and voiding it means a
  **refund**.
- **Staff walk-in / "Rent"** (`paid-in-cash`, `walked-in`) — cash handled offline.
- **Staff hold / "Reserve"** (`held`, `expected`) — no money.
- **Comp** (`isComp`, `OP_COMP`) / **Block** (`blocked`) — no money.

**States & transitions (LOCKED 2026-06-17).** Seven seat states. Each line is `[Button] → state`;
`⚠` = confirmation step required; vacate outcomes note money/record. Underlying
`(payment status / operationalStatus)` given per state for the build.

**Available** · green · `(— / —)` — empty seat
- `[Rent]` → Walk-in
- `[Reserve]` → Held
- `[Comp]` → Comp
- `[Block]` → Blocked
- *(beachgoer books in-app / QR — system, not a staff button)* → Reserved
- *(all four are one-tap — no confirm; creating an occupancy on a free seat is cheap & reversible.
  Block had a confirm step; removed 2026-06-17.)*

**Reserved** · yellow · `(complete / expected)` — paid online, not arrived
- `[Check in]` → Checked-in
- `[No-show]` ⚠ → Available *(logs no-show · payment kept)*
- `[Cancel]` ⚠ → Available *(logs canceled · refunded)*
- `[Move]` → Reserved (other seat)

**Held** · yellow · `(held / expected)` — staff hold, no payment
- `[Rent]` → Walk-in *(converts the hold IN PLACE to a paid walk-in — the arrival / collect-payment
  path; the Held panel shows a **multi-day period picker above Rent**, plus a **name input ONLY if the
  hold has no name yet** (if it was held with a name, show that name read-only). Same period UX as the
  Available→Rent flow. Extending beyond today re-checks availability, excluding the hold itself.)*
- `[Release]` → Available *(no money)*
- *(no Check-in, no Move — a held guest who arrives is **Rented**, not checked-in; this removes the
  unpaid-`checked-in`-`held` limbo where Cancel failed. Updated 2026-06-17.)*

**Checked-in** · blue · `(complete / checked-in)` — guest present (always a paid online booking now,
since Held converts via Rent, never Check-in)
- `[Depart]` ⚠ → Available *(logs departed · payment kept)*
- `[Cancel]` ⚠ → Available *(refunded if a payment exists; else just released)*
- `[Move]` → Checked-in (other seat)

**Walk-in** · orange · `(paid-in-cash / walked-in)` — staff rental, cash, present
- `[Depart]` ⚠ → Available *(cash kept)*
- `[Unreserve]` ⚠ → Available *(removes the walk-in; cash settled offline)*
- `[Move]` → Walk-in (other seat)
- *(both Depart and Unreserve now confirm — updated 2026-06-17; supersedes the earlier
  "Walk-in Depart unconfirmed" call.)*

**Comp** · purple · `(isComp / comp)`
- `[End comp]` → Available

**Blocked** · gray · `(— / blocked)`
- `[Unblock]` → Available

**In-flight online** · `(pending·processing / expected)` — transient, rare on the floor:
`[Release]` → Available (the cleanup cron also GC's stale ones).

**Invariants:**
1. **`Rent` / `Reserve` / `Comp` / `Block` exist only on an Available seat** — the whole guard. An
   occupied (esp. paid Reserved) seat never shows them, so it can't be clobbered; take it back to
   Available first (Cancel / Release / Depart / Unblock / End-comp).
2. **Cancel refunds via `issueRefund` only if a payment exists** (Reserved / paid Checked-in); on an
   unpaid seat it just releases. Always `⚠` confirmed.
3. **No-show vs Depart** both keep the money and free the seat; they record different facts
   (never-arrived vs arrived-then-left) and are gated to different prior states. Both are now `⚠`.
4. **Reserved and Held both render yellow** and both count under the toolbar `R`; they differ only by
   buttons (paid Reserved → Check-in/No-show/Cancel; Held → Rent/Release). P7 splits the yellow panel
   by payment class.
5. **Seat/Group toggle is driven by `inSync`** (all group members share the same active reservation,
   or all are free). When `inSync` the two-option [Group/Pair | Seat] control is shown; when
   `!inSync` (e.g. one seat walk-in, one seat free) the control collapses to a single non-interactive
   "Seat" indicator — the action scope is locked to this seat. The header `+#peer` companion is also
   hidden when `!inSync` (the peer is on a different reservation, so showing it is misleading).
   `applyToPair` starts as `inSync` and can only be toggled while `inSync`; when `!inSync` it stays
   `false`.
6. **Walk-in Depart in Seat mode disconnects rather than departs.** A paired walk-in shares ONE
   reservation row. When staff choose "Seat" mode (i.e. `!applyToPair`) on an in-sync group and
   confirm Depart, `BedDetail` calls `unreserveItem(itemId, …, applyToPair=false)` which disconnects
   this item from the shared reservation (the partner stays walked-in). `markDeparted` is used for all
   other depart cases (Group mode, a non-grouped single walk-in, any out-of-sync single-seat
   reservation, and Checked-in depart).

**What P7 must BUILD (the gaps vs today):**
- A **partner-side `cancelReservation`** action (gated; wires the provider-agnostic `issueRefund`)
  + a **confirmation dialog** in `BedDetail`. Today cancel-with-refund lives only in the *user* app;
  the manage page has check-in/no-show but no refund path.
- **Confirmation guards on the `⚠` transitions:** Reserved → No-show, Reserved → Cancel, Checked-in
  → Depart, Checked-in → Cancel, **Walk-in → Depart, Walk-in → Unreserve** (the last two added in the
  2026-06-17 fix-pass). A shared confirm affordance, not bespoke dialogs.
- **Enforce invariant 1 in `BedDetail`:** creation actions render only in the free state; occupied states
  render only their row above. (Largely true for the available state already — audit + tighten so a
  paid/held/walk-in/comp/block bed never exposes Rent/Reserve/Comp/Block.)
- **Branch the "expected" lane by payment class:** complete→{Check-in, No-show, Cancel}; held→{Rent,
  Release}. Both render yellow today; consider a subtle paid/locked marker so staff can tell a paid
  online booking from a staff hold at a glance (optional refinement).

**Decided OUT / deferred (2026-06-17) — not gaps, choices:**
- **`expected → departed` shortcut** (one-tap "came & went, never logged") — **not building**. Normal
  Depart stays (only from `checked-in`/`walked-in`). A used-but-never-checked-in bed is honestly a
  no-show. Revisit only if it proves common on a real floor.
- **`HOLD → Rent` conversion** — **ADOPTED 2026-06-17** (was deferred). A held guest who arrives is
  **Rented** (hold converted in place to a paid walk-in), not checked-in. This replaced the
  Held → Check-in path, which left an unpaid `checked-in`+`held` limbo where Cancel failed.

The machine is now fully settled and self-consistent. Everything is shipped EXCEPT P7 (the three
build items above): partner-side Cancel/refund + confirm, creation-only-on-FREE enforcement, and
branching the expected lane by payment class.

## Resume here

- **P7b — NEXT (cross-app refund extraction).** P7 shipped the partner `cancelReservation` action
  (status → CANCELED, `revalidatePath`) with a loud `issueRefundPlaceholder` NO-OP stub. The real
  work: extract `issueRefund` / `getPaymentStatus` from `apps/user/app/api/_lib/payment-provider.ts`
  into `@repo/data` (a data-dev + architecture pass — blast radius is both apps + `@repo/data`
  exports), then swap the `issueRefundPlaceholder` call in `manage/actions.ts:cancelReservation` for
  the real thing. **The manage-page cancel is NOT deployable until P7b completes.** Until then, the
  action sets the status but does not issue a refund. See Log 2026-06-17 P7 entry for details.
- **Copy review owed before `promote-to-test`:** new i18n keys `held`/`release`/`cancelReservation`/
  `back`/`confirmNoShow`/`confirmCancel`/`confirmDepart` in BedDetail have first-pass ES/FI machine
  translations — flag for human review per `.claude/rules/deploys.md` user-facing copy gate. Prior
  outstanding keys: `rent`/`rentDays` (from P6).
- **Owed before any `main` push:** `migrate:test` (Neon TEST DB) for the `isComp` migration
  (`20260617135331_add_reservation_iscomp`). Pre-push hook enforces this.
- **P5 — `desactivada` out-of-service lifecycle is DEFERRED (optional).** Today's `blockBed` /
  `unblockBed` (operationalStatus='blocked') already behaves as a workable out-of-service state —
  ephemeral block for maintenance, deleted on unblock. The conceptual difference from Alonso's
  `desactivada` (sticky, one-way exit) is a UX/lifecycle refinement, not a missing capability.
  Revisit only if the operator workflow reveals a real friction. No data changes required to defer.
- **Roadmap is essentially complete.** P1–P4 + P6 all shipped. P5 is the only open item and is
  explicitly deferred pending user feedback. The track is in a stable, shippable state.
- **`migrate:test` DONE (2026-06-17):** the `isComp` migration (`20260617135331_add_reservation_iscomp`)
  is now applied to the Neon TEST DB (verified `Reservation.is_comp` exists). The pre-push hook is
  unblocked for a `main` push. `RESERVATION_HELD` needed no migration (string-value status only).
- **Copy review owed before `promote-to-test`:** the new i18n keys `rent` / `rentDays` in
  `BedDetail` have first-pass ES/FI machine translations (`Alquilar` / `Vuokraa`) — flag for
  human review per the user-facing copy gate in `.claude/rules/deploys.md`.

## Roadmap

- ✅ **P1 — Shell: decompose + toolbar + kill sectioned view.** DONE 2026-06-17. Break the `view.tsx` monolith into
  `ManageToolbar` / `ParcelView` / `RentalsSection` components; replace the fat status bar with a
  thin `<ManageToolbar>` (zoom + compact occupancy readout); **remove the Sections/Scroll toggle and
  all sectioned-grid rendering** — grid is always scroll+zoom. Parcels stay stacked-scroll (switcher
  is P2). *Partner-app only, no data changes.*
- ✅ **P2 — View switcher: one destination at a time.** DONE 2026-06-17. Segmented switcher in
  `ManageToolbar` (parcel tabs + a 🏄 rentals tab, `accent`-styled active state, horizontally
  scrollable, hidden when only one destination); `ManageView` holds lazily-initialised `selectedView`
  state (defaults to lowest parcel, falls back to rentals). One parcel's `ParcelView` **or** the
  rentals view renders at a time. **P3 folded in here** — rentals became a switcher destination
  rather than a separate later phase, since one-at-a-time forced its placement. *UI only.*
- ✅ **P3 — Rentals as its own view.** DONE (folded into P2 — the rentals destination is a switcher
  tab; there was no separate stacked-rentals state left to migrate).
- ✅ **P4 — Comp (`gratis`) state.** DONE 2026-06-17. Architecture pass done; data layer shipped (prev
  session). Partner UI slice complete: `compBed`/`uncompBed` actions in `manage/actions.ts` (mirror
  blockBed/unblockBed, `operationalStatus=OP_COMP`, `isComp:true`, `paymentAmount:0`); both registered
  in gated-actions registry; auth-matrix coverage auto-added (376→390 tests). `getBedState` updated in
  both `view.tsx` and `ParcelView.tsx` (import + case OP_COMP). `BedState` union extended in all 4 files
  (`view.tsx`, `ParcelView.tsx`, `ManageToolbar.tsx`, `BedDetail.tsx`). Color: **purple**
  (`bg-purple-300 border-purple-500`, `text-purple-600` in toolbar). Icon: `★`. Toolbar readout now
  reads `O{occupied} R{reserved} C{comp} {free}` (C segment only shown when comp>0). `BedDetail`
  added Comp action (★ button alongside Block + Reserve) and Comp state section (purple card + "End
  comp" button). i18n keys added in en/es/fi (comp/endComp in BedDetail + comp in SiteManage — ES/FI
  are first-pass machine translations, need review before promote). 16 new unit tests
  (manage/actions.test.ts 84→100). tsc clean, lint clean, 1256 tests all green. `isComp` added to
  `types/shared.ts` Reservation interface.
- 💤 **P5 — Out-of-service lifecycle (`desactivada`). DEFERRED.** Today's ephemeral block
  already covers the core use case. Revisit only if operator feedback reveals friction. No data
  changes pending.
- ✅ **P6 — Lightweight same-day hold.** DONE 2026-06-17. `holdBed` server action added to
  `manage/actions.ts` (mirroring `blockBed`/`compBed`: same ownership check, pair-expansion via
  `getGroupMemberIds`, `reserveWithConflictGuard`, `revalidatePath`). Status: `RESERVATION_HELD`
  (`held`), `operationalStatus: OP_EXPECTED` (yellow "booked" lane — no color/state/Item.tsx
  changes needed), `paymentAmount: 0`, today-only, no `checkedInAt`. Registered in
  `gated-actions.ts` (token-or-session gate); auth-matrix now 397 tests. `BedDetail.tsx`:
  existing "Reserve" button relabeled **"Rent"** (`t('rent')`/`t('rentDays',{n})`) — behavior
  unchanged, still calls `reserveItem` as a paid walk-in; new **"Reserve"** button (yellow,
  calls `holdBed`) added alongside it. Cleanup cron updated: `RESERVATION_HELD` added to the
  expired-walk-in cleanup branch (same `createdAt < today-start + to < now` guards). i18n:
  `rent`/`rentDays` added in en/es/fi (ES/FI first-pass, need human review before promote).
  9 new unit tests. tsc clean, lint clean, 1272/1272 tests green.
- ✅ **P7 — Paid-booking guard + manage-side Cancel/refund. DONE 2026-06-17 (refund placeholdered;
  NOT deployable until P7b).** Gated `cancelReservation` action in `manage/actions.ts` (idempotent:
  status → CANCELED; `issueRefundPlaceholder` is a loud NO-OP with TODO P7b comment; `revalidatePath`).
  Gated `releaseHold` action (mirrors `unblockBed`, deletes the held reservation, graceful no-op when
  none found). Both registered in `gated-actions.ts` (auth-matrix 397→411 tests). `BedDetail.tsx`
  overhauled: (a) `pendingConfirm` state replaces `showNoShow` — shared one-step confirm affordance for
  all ⚠ transitions (no-show, cancel, depart); (b) expected lane split by `reservation.status`:
  COMPLETE → {Check-in, No-show ⚠, Cancel ⚠}, HELD → {Check-in, Release}; dashed-border card to
  distinguish hold from paid booking; (c) Checked-in: Depart now ⚠, Cancel ⚠ added; (d) Walk-in:
  Depart stays unconfirmed (no money); (e) creation actions (Rent/Reserve/Comp/Block) gated to
  `state==='available'` only — already was, confirmed by audit. `page.tsx`: `status: { notIn:
  TERMINAL_STATUSES }` added to reservations query so canceled reservations don't shadow free beds.
  i18n: 7 new keys in BedDetail (held/release/cancelReservation/back/confirmNoShow/confirmCancel/
  confirmDepart) in en/es/fi — ES/FI first-pass machine translations, need human review before
  promote. 10 new unit tests in `manage/actions.test.ts`. tsc clean, lint clean, 1296/1296 green.
- ☐ **P7b — Real refund wiring (cross-app, data-dev + architecture pass).** Extract
  `issueRefund`/`getPaymentStatus` from `apps/user/app/api/_lib/payment-provider.ts` into `@repo/data`.
  Rewire user app (existing references) and swap the `issueRefundPlaceholder` in
  `manage/actions.ts:cancelReservation` for the real call. Blast radius: `@repo/data`, both apps,
  both apps' mocks. Must go through `data-dev` + architecture pass before coding.
- 💤 **Backlog (out of scope, noted for continuity):** daily per-employee till / cash-close +
  floor-staff attribution (Alonso lessons 3–4); realtime push transport; plain CSV/TXT export +
  rolling-window accounting lens. These live in `.claude/alonso/model/synthesis-sunbnb.md` and
  align with [[track:002-table-reservations]] — separate tracks when started.

## Log

- **2026-06-17** — Track created off [[track:005-alonso-beach-model]] (now done). User scoped the
  effort to the staff/manage UI, asked to borrow Alonso's simpler states + clearer chrome without
  wholesale replacement. Three forks resolved with the user: **interleave** UI+data as vertical
  slices; **remove the sectioned view** (switcher = one parcel/rentals at a time, scroll+zoom
  within); **defer theme** (toolbar v1 = zoom + occupancy readout + switcher). Digested the current
  manage surface (single `view.tsx` monolith: fat status bar 538–627, per-parcel sections, rentals
  section, `BedDetail`/`CreateRentalModal`; states available/expected/checked-in/walked-in/blocked;
  no comp, no light hold) and the Alonso state model. Roadmap set P1→P6. Starting P1 (shell).
- **2026-06-17** — P1 completed. `view.tsx` decomposed into `ManageToolbar.tsx` (thin sticky
  toolbar with compact occupancy pips + zoom control), `ParcelView.tsx` (one parcel's scroll+zoom
  grid + PoolSection), `RentalsSection.tsx` (equipment rental block). Sectioned view path deleted
  entirely: `ViewMode` type, `VIEW_MODE_KEY`, `handleViewMode`, `SectionsIcon`/`ScrollIcon`,
  toggle UI, `chunkDisplayColumns`/`computeChunkSize`/`chunkRows`/`ColumnSection`/`RowCells`/
  `GridSection`/`SECTION_GROUP_GAP_PX`/`SECTION_FIT_WIDTH`/`containerWidth`/ResizeObserver all
  gone. `viewSections`/`viewScroll` i18n keys removed from en/es/fi. Grid is always scroll+zoom.
  All scroll+zoom, pinch, drag-to-pan, zoom-localStorage, parcel-reverse-localStorage, PoolSection,
  30s auto-refresh, and both modals preserved. tsc clean, grid-helpers (9) + manage (86) = 95 tests
  pass. Pre-existing 5 BUG-labelled inventory/actions failures are unrelated to this change.
- **2026-06-17** — P2 completed (+ P3 folded in). User refined the toolbar twice: dropped the
  pip+label occupancy block for a **compact color-coded readout `O{occupied} R{reserved} {free}`**
  (blue / amber / green, no slashes, no word labels; `R`=expected/reserved, `free`=available, total
  dropped) — `ManageToolbar.tsx`. Added the **view switcher** (one parcel `ParcelView` or the 🏄
  rentals view at a time, `accent`-styled active tab, auto-hidden when ≤1 destination). Per user
  request the switcher pills were **moved OUTSIDE the white header card** into their own bare,
  single-row, horizontally-scrollable strip below it (the card — stats + zoom — stays sticky).
  Then rentals navigation was **pulled out of the pill row into a floating round FAB**
  (`fixed bottom-6 right-6`, `accent`, icon-only): it shows the destination it switches to — 🏄 when
  in a parcel, ⛱️ when in rentals — and returns to the *last* parcel viewed (`lastParcel` state),
  not always the first. Pills now carry parcels only (shown when >1 parcel); the FAB only renders
  when rentals is enabled AND ≥1 parcel exists. `ManageView` gained the `useTranslations` hook for
  the FAB label. Finally, per user, the **rentals view shows a minimal placeholder header** (🏄 +
  `t('rentals')`) instead of the full toolbar — stats/zoom/parcel-tabs are parcel-view-only. This is
  a deliberate "for now" state: the rentals view will grow its own toolbar affordances in a later
  pass (it currently relies on `RentalsSection`'s own header + Rent-Out button below). Also removed
  the per-parcel header (`Parcel N` title) from `ParcelView` and **moved the reverse-seat-order `⇄`
  toggle into the toolbar header** (right of the zoom control); it acts on the active parcel
  (`ManageView` feeds it `isParcelReversed(effectiveParcel)` + a scoped toggle). Per-parcel reverse
  persistence is unchanged. `ManageView` gained lazily-initialised
  `selectedView` state (default = lowest parcel, else rentals) + `effectiveParcel` resolution
  (falls back to first parcel if selection vanished). Done directly (not via partner-dev — Agent
  classifier was down during an Opus outage); all four manage files type-clean (only the unrelated
  pre-existing `inventory/actions.ts:28` error remains), lint 0 errors (the one new `no-unused-vars`
  warning on a callback param name matches `ParcelView`'s six — established house style), 95
  manage+grid tests pass. Occupancy mapping (occupied/expected/total) is a one-line change if the
  user later wants *free* as the lead number. **UI half of the track (P1–P3) is complete; P4 begins
  the data slices and needs the architecture pass.**

- **2026-06-17** — P4 architecture pass + data layer. Investigation: **accounting revenue is
  entirely invoice-driven** (`getPaidItemsByMonth` counts only `status=complete` reservations that
  have an `Invoice`; sums `invoice.totalAmount`). Manage-page operational reservations (walk-ins,
  blocks) are created directly with **no invoice**, so they never hit revenue — a comp is the same,
  so **revenue exclusion is automatic** (no accounting code change). User chose (2 forks): a
  **durable `isComp` field** (not status-string-only) so comps are queryable for future reporting,
  and a **comp counter in the toolbar stats**. Shipped the data layer: added
  `Reservation.isComp Boolean @default(false) @map("is_comp")` (migration
  `20260617135331_add_reservation_iscomp`, additive/expand-safe — `ADD COLUMN … DEFAULT false`),
  applied to local + `sunbnb_test` via `migrate:local`, `prisma generate` done. Added `OP_COMP='comp'`
  to `reservation-status.ts`. `reserveWithConflictGuard` needs **no change** —
  `ReservationCreateData = Omit<Prisma.ReservationCreateInput, …>` now includes `isComp`, which
  spreads through to `tx.reservation.create`. `reservation-status` isn't a mocked module, so no
  mock-contract churn from `OP_COMP`. Migration NOT yet pushed to Neon TEST DB — `migrate:test` is
  owed before any `main` push (additive, pre-push hook will enforce). Partner UI/actions/tests next.
- **2026-06-17** — P4 partner UI slice. `compBed`/`uncompBed` server actions added to
  `manage/actions.ts` mirroring `blockBed`/`unblockBed`: `status=RESERVATION_PAID_IN_CASH`,
  `operationalStatus=OP_COMP`, `isComp:true`, `paymentAmount:0`, pair-expansion via
  `getGroupMemberIds`, conflict guard, `revalidatePath`. Both registered in `app/test/gated-actions.ts`
  (token-or-session gate). Auth-matrix now 390 tests (376+14 for 2 new actions × 7 scenarios).
  Coverage-contract still green. `BedState` union extended to `'comp'` in all 4 manage-layer files.
  `getBedState` + `case OP_COMP` in both `view.tsx` and `ParcelView.tsx`. Purple color scheme
  (`bg-purple-300 border-purple-500`, `text-purple-600` in toolbar). `★` icon for pool cells.
  `ManageToolbar` readout: `O R C free` (C segment conditionally rendered when comp>0).
  `BedDetail` gains Comp action button (★, `w-16` square alongside Block) from available state and
  a purple comp card + "End comp" button from comp state. i18n: `comp`/`endComp` keys in
  BedDetail + `comp` in SiteManage, en/es/fi — ES/FI are machine-translated first-pass, need human
  review before promote. `isComp?: boolean` added to `types/shared.ts` Reservation interface.
  tsc clean, lint clean, 1256/1256 tests green. `migrate:test` (Neon TEST DB) still owed.

- **2026-06-17** — P4 follow-up fix: comped regular seats weren't turning purple (data was correct —
  `BedDetail` offered "End comp"). Cause: **`Item.tsx` (the regular seat cell) holds its OWN
  duplicated `BedState`/`getBedState`/`stateStyles`**, separate from `POOL_STATE_STYLES` (which only
  styles pool + group-extra cells). P4 updated view/ParcelView/ManageToolbar/BedDetail but missed
  `Item.tsx`. Added `OP_COMP → 'comp'` (purple ★) there. **Correction to the state-add checklist: it's
  8 files, and `Item.tsx` is the one that colors REGULAR seats** — must be updated for P5
  (`desactivada`) and any future operational status. (Full set: `Item.tsx`, `view.tsx`,
  `ParcelView.tsx`, `ManageToolbar.tsx`, `BedDetail.tsx`, `actions.ts`, `gated-actions.ts`,
  `types/shared.ts`.)

- **2026-06-17** — P6 complete. `holdBed` action added to `manage/actions.ts` (`status=held`,
  `operationalStatus=expected`, `paymentAmount=0`, today-only, no `checkedInAt`, pair-expansion,
  conflict guard). Registered in `gated-actions.ts` (auth-matrix 390→397). `BedDetail.tsx`:
  old Reserve button relabeled "Rent" (calls `reserveItem`, same paid-walk-in behavior);
  new "Reserve" button (yellow, calls `holdBed`) added — action row is now Block | Comp | Reserve
  | Rent. Cleanup cron: `RESERVATION_HELD` added to expired-walk-in branch (no migration needed
  — `held` is a string constant, plain String DB column). i18n: `rent`/`rentDays` added to
  en/es/fi — ES/FI are first-pass machine translations, need human review before promote. 9 new
  unit tests. P5 explicitly deferred — today's block already handles the out-of-service use case.
  `migrate:test` (Neon TEST DB) still owed for the `isComp` migration before `main` push.

- **2026-06-17** — State-machine design session (P7, build deferred). User stepped back to think
  about the whole manage state machine given Sunbnb (unlike Alonso) has an **online/QR consumer
  booking channel** as the baseline staff modify. Clarified **no-show vs cancel** = different money
  outcomes (no-show keeps revenue + resells the bed; cancel refunds via `issueRefund`) → **both are
  needed**. Decided: a **paid online booking is guarded** by only ever offering creation actions
  (Rent/Reserve/Comp/Block) on a **free, unoccupied seat** (user: "hide them; only on unoccupied and
  unpaid seats") — so occupied/paid beds can't be clobbered; a paid booking shows Check-in / No-show
  / Cancel(refund, confirmed) + Move/Notes. Found the gap: the manage page has **no cancel/refund
  action** (it's user-app-only) — that's the core of P7. Recorded the full two-axis model + action
  matrix in the "Manage state machine — target design" section above; user chose **design only for
  now**, build deferred.

- **2026-06-17** — State machine **finalized**. Clarified no-show vs depart (same outcome — vacate +
  keep money; differ only in recorded fact: never-arrived vs arrived-and-left, and gated to different
  prior states). Parked two items by decision (not gaps): the `expected → departed` shortcut (not
  building) and `HOLD → Rent` conversion (deferred; hold reuses Check-in/Release for now). Full
  transition diagram + invariants live in "Manage state machine — target design". Design complete;
  P7 (Cancel/refund + creation-only-on-FREE + expected-lane branch) is the only unbuilt slice, deferred.

- **2026-06-17** — State machine **LOCKED** in state-transition form (replaced the matrix, which read
  as clutter). Names locked: **Available · Reserved · Held · Checked-in · Walk-in · Comp · Blocked**.
  User mods applied: (a) **removed Move from Held**; (b) **confirm (`⚠`) on Reserved → No-show and
  Reserved → Cancel**; (c) **confirm on Checked-in → Depart and Checked-in → Cancel** (Walk-in →
  Depart stays unconfirmed). Design complete; P7 (Cancel/refund action + the `⚠` confirms +
  creation-only-on-Available + expected-lane split) is the only unbuilt slice, deferred.

- **2026-06-17** — P7 complete (refund placeholdered; NOT deployable until P7b). Delivered in one
  partner-app-only slice: (1) `cancelReservation(siteId, itemId, accessKey?, applyToPair=true)` —
  finds active `status=complete` reservation overlapping today by itemId; idempotent if already
  CANCELED; calls `issueRefundPlaceholder` (console.warn + loud TODO comment, actual P7b work deferred);
  updates `status → RESERVATION_CANCELED`; does NOT delete row (audit trail). (2) `releaseHold(siteId,
  itemId, accessKey?, applyToPair=true)` — mirrors `unblockBed` but targets `RESERVATION_HELD`; in pair
  mode calls `deleteMany` (graceful no-op when none); in single-seat mode disconnects item or deletes
  whole hold. Both registered in `gated-actions.ts`; auth-matrix 397→411 tests. (3) `page.tsx`:
  `status: { notIn: TERMINAL_STATUSES }` added to reservations include-where — canceled reservations
  now drop off the manage floor so the bed shows free. (4) `BedDetail.tsx` full overhaul: replaced
  `showNoShow: boolean` with `pendingConfirm: 'no-show' | 'cancel' | 'depart' | null`; shared
  `confirmPanel` const; expected lane split (COMPLETE = yellow solid border; HELD = yellow dashed
  border); checked-in gains Cancel ⚠; Depart made ⚠; walk-in Depart stays unguarded; creation
  actions (Rent/Reserve/Comp/Block) confirmed available-only by audit. (5) i18n: 7 new keys in
  en/es/fi under BedDetail (held/release/cancelReservation/back/confirmNoShow/confirmCancel/
  confirmDepart). (6) 10 new unit tests. Architecture decision: `applyToPair` on `cancelReservation`
  is a no-op (canceling updates the whole reservation row regardless; included for API consistency).
  `paymentRef` selected server-side in Prisma query, NOT added to `Reservation` type (client doesn't
  need it). tsc clean, lint clean, 1296/1296 green. P7b is the hard cross-app work.

- **2026-06-17** — **Held → Rent multi-day flow.** `convertHoldToWalkIn` extended with optional
  `until?: string` param (same validation as `reserveItem`: valid date, not past, ≤90 days). Today-only
  conversion keeps the existing simple `findFirst` + `update` path. When `until` extends past today a
  hold only covers today, so availability for the extended range is re-checked atomically inside a
  `prisma.$transaction`: (1) find hold + get connected item ids, (2) `SELECT ... FOR UPDATE` lock those
  items, (3) conflict-check for OTHER blocking reservations on those items overlapping `[todayStart,
  toDate]` excluding the hold's own id — returns `'Seat is already reserved for part of this period'`
  on conflict, (4) update in place. `BLOCKING_STATUSES` added to imports. BedDetail Held panel
  updated: period picker (calendar toggle + date-range row, mirroring Available) always visible;
  name input shown ONLY when hold has no name yet (read-only name from the info card otherwise); Rent
  button passes effective name (hold name if set, else typed) + `until`; label shows `rentDays(n)`
  when days>1. No new i18n keys needed — all keys (`guestName`, `multipleDays`, `until`, `cancel`,
  `rent`, `rentDays`, `release`) already existed. 8 new unit tests: today-only sets `to=endOf(today)`,
  multi-day sets correct `to`, conflict rejects and skips update, self-exclusion verified, not-found
  inside tx, invalid/past/over-90-day rejections. tsc clean, lint clean, 1319/1319 tests green.

- **2026-06-17** — BedDetail fix-pass (3 fixes, partner-app only). (1) **Fix 1 — Block one-tap**: removed
  `showBlock` state and block-confirm panel from `BedDetail.tsx`; Block button now calls `blockBed`
  directly via `runAction`. (2) **Fix 2 — Held → Rent conversion**: new `convertHoldToWalkIn(siteId,
  itemId, accessKey?, guestName?)` action in `manage/actions.ts` — finds today-overlapping
  `status=held` reservation by itemId, updates IN PLACE to `status=paid-in-cash`,
  `operationalStatus=walked-in`, `checkedInAt=now`; guestName applied only when non-empty (preserves
  hold's existing name otherwise). Registered in `gated-actions.ts` as `token-or-session`.
  `BedDetail` Held panel: Check-in button replaced with orange **Rent** button calling
  `convertHoldToWalkIn(..., reservation.guestName ?? undefined)`. Release kept. (3) **Fix 3 —
  Walk-in confirms both Depart and Unreserve**: `PendingConfirm` extended with `'unreserve'`;
  `runPendingConfirm` routes `'unreserve'` → `unreserveItem`; Walk-in panel wrapped in
  `{pendingConfirm ? confirmPanel : (...)}` — Depart → `setPendingConfirm('depart')`, Unreserve →
  `setPendingConfirm('unreserve')`; `confirmPanel` message adds `'unreserve'` branch →
  `t('confirmUnreserve')`. i18n: `confirmUnreserve` added to en/es/fi (ES/FI first-pass machine
  translations — flag for human review before promote). Auth-matrix: 411→418 tests (+7 for
  `convertHoldToWalkIn`). 8 new unit tests for `convertHoldToWalkIn`. tsc clean, lint clean,
  1311/1311 tests green.

- **2026-06-17** — Confirm-dialog polish (user): the group-scope **"Both seats / This seat only"
  toggle is hidden while a `⚠` confirm is showing** (`&& !pendingConfirm` on the toggle render), and
  the confirm copy rewritten from questions to **descriptive action+consequence statements** (e.g.
  walk-in unreserve → "Ending this walk-in. Settle any cash refund with the customer directly; the
  seat frees up."). `confirmNoShow/Cancel/Depart/Unreserve` updated in en/es/fi (ES/FI first-pass,
  copy-review still owed). tsc/lint clean; presentational-only, 1311 tests unaffected.

- **2026-06-17** — Group-scope toggle relabeled (user): the `BedDetail` "All seats / This seat only"
  toggle now reads **"Group" / "Seat"** when the group has >2 seats and **"Pair" / "Seat"** when
  exactly two (`groupItems.length >= 2 ? t('group') : t('pair')` + `t('seat')`). Replaced the
  `bothSeats`/`thisSeatOnly` i18n keys with `group`/`pair`/`seat` in en/es/fi (ES/FI first-pass).
  Also (earlier this session) the Held→Rent panel gained a multi-day period picker + a name input
  shown only when the hold is unnamed, and `convertHoldToWalkIn` now re-checks availability
  (FOR UPDATE + self-excluding conflict) when the rental extends past today. tsc/lint clean, 1319 green.

- **2026-06-17** — Group/Seat toggle consistency fix (4 bugs). (1) **Toggle gated on `inSync`**: the
  two-option [Group/Pair | Seat] toggle now only renders when `inSync` (all group members share the
  same reservation, or all are free); an out-of-sync group collapses to a single non-interactive
  "Seat" indicator (`div` with same dark `bg-gray-900 text-white min-h-[44px]` styling as the active
  button — staff see scope is locked). This fixes the "partially occupied group still shows Group
  option" bug and prevents the conflict-guard error that occurred when trying a Group walk-in on a
  partially occupied pair. (2) **Walk-in Depart honors the toggle**: when `state=walked-in &&
  !applyToPair && inSync && groupItems.length > 0`, `runPendingConfirm` now calls
  `unreserveItem(itemId, …, false)` (disconnect this seat from the shared walk-in reservation) instead
  of `markDeparted(reservationId)`. All other depart cases (Group mode, non-grouped walk-in, checked-in
  depart, out-of-sync seat) still call `markDeparted`. (3) **Header `+#peer` gated on `inSync`**:
  `thisResId`/`inSync` computation moved above `pairNumber`; `pairNumber` now includes `|| !inSync`
  in its undefined condition — out-of-sync: the peer label is suppressed. (4) **Dead `applyToPair`
  param removed from `cancelReservation`**: was a documented no-op (cancel updates the whole
  reservation row regardless; `applyToPair=true` was the only default but never used by any caller
  except one that already omitted it). Removed the param + updated JSDoc. No i18n changes needed —
  all keys (`seat`, `group`, `pair`) already existed. No new gated-actions changes needed. tsc clean,
  lint clean, 1319/1319 tests green. Invariants 5 + 6 added to the state-machine section above.

- **2026-06-17** — Cross-app bug fix (surfaced while testing consumer booking against manage-created
  groups; **pre-existing prod bug, not introduced here**): a pair/group with **overflow "extra" seats**
  (`status='pool'`, walk-in only) was **unbookable online**. The consumer site fetch's
  `sunbedGroup.items` include had no status filter → leaked pool ids → tapping a pair co-selected the
  pool extras → server's active-only availability set rejected them ("some items not available"), even
  though every seat reads green (the extras are free). Fix (user confirmed pool extras are
  overflow/walk-in only, must be invisible+inert in consumer app AND partner inventory editor, manage
  page unchanged): (a) `apps/user/app/api/sites/[id]/route.ts` — filter `sunbedGroup.items` include to
  `status:'active'`; (b) `apps/partner/.../inventory/view.tsx` — the four `group`-integer selection
  builders now also exclude `status!=='pool'` (rendering/marquee/ParcelForm already did). User tsc +
  partner tsc clean; user api/sites route tests green. **Diagnosis aside:** local DB has heavy stale
  test reservations (cron not running locally); Neon TEST DB still missing `is_comp` (migrate:test owed).

- **2026-06-17** — Ran `migrate:test`: the `isComp` migration is now applied to the Neon TEST DB
  (`migrate status` showed it as the only pending; `migrate deploy` applied it + regenerated the
  client; verified `Reservation.is_comp` exists on test). Pre-push hook unblocked for `main`. Still
  owed before promote: ES/FI copy review; and P7b (real refund — Cancel still placeholdered).

## Open decisions

- **State-model representation (owed before P4).** Are `gratis` / `desactivada` / lightweight-hold
  new `operationalStatus` string values (operationalStatus is already a plain String column — likely
  cheapest, maybe no migration) or do any need a schema column (e.g. a comp/`isComp` flag for clean
  accounting exclusion)? Decide in the P4 architecture pass with the user before touching `@repo/data`.
- **Hold vs reservation overlap (P6).** Does the lightweight hold reuse the `expected` operational
  status with a "no payment" marker, or get its own status? Affects the cleanup cron and the
  reservation status machine.

## Links

- [[track:005-alonso-beach-model]] — the research this builds on; design source for every borrowed
  concept. Payload: `.claude/alonso/model/synthesis-sunbnb.md`.
- [[track:002-table-reservations]] — sibling "leisure-venue OS" ambition; the floor-ops layer this
  track thickens is the same vision's on-site half.
- Target surface: `apps/partner/app/sites/[id]/manage/`.
- Rules in force: `.claude/rules/architecture.md` (P4+ is a schema/cross-app pass),
  `.claude/rules/ui.md` + `apps/partner/UI.md` (prime `/ui partner`), `.claude/rules/data-access.md`
  + `.claude/rules/migrations.md` (P4+).
</content>
</invoke>
<invoke name="Read">
<parameter name="file_path">/Users/vhalme/projects/sunbnb/sunbnb-app/apps/partner/app/sites/[id]/manage/view.tsx