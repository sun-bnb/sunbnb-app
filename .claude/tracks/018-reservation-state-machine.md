---
id: 018-reservation-state-machine
title: Reservation state machine — explicit model, conservation contracts, matrix enforcement
status: active
created: 2026-08-11
updated: 2026-08-11
worktree: null
---

## Goal

**Motivation (founder, 2026-08-11):** the reservation state machine's grown complexity
(tracks 011/012/013/015/016, each addition locally reasonable) caused loss of control
over **validation, testing, and maintenance** — no artifact forces the transitions to
stay mutually consistent, so correctness now depends on reading code paths. The point of
this track is to restore that control (one-page model to validate against; generated
total-coverage tests; future changes = reviewable table diffs), then put reservation
flow logic in proper order on those rails. Not abstraction for its own sake.

Reservation "state" today is a **compound derived at read time** — `status` (payment) ×
`operationalStatus` × today's `ReservationDay` row × stay-over rule × `tillEntries`
presence × `paymentRef` shape — and every transition is an ad-hoc guard inside a server
action. Bugs live in the compounding: transitions that mutate one component conserve some
side effects and silently drop others (till ledger, receipt invoices, settled-flag).

End state: an **explicit state machine** — enumerated compound states + a transition table
(event × state → state, with a per-transition **side-effect contract**: what must be
created / voided / conserved across seats, cash ledger, invoices, paymentAmount) — encoded
as data in one place, with a single guard the actions call, and **matrix tests generated
from the table** (auth-matrix pattern: every state × event cell asserted, including
must-reject cells). Known logical errors become red cells first, then fixes.

## Resume here

- **Next action:** commit slice (b) — the meta-guard (awaiting founder's word) — then P2
  slice (c): additive `splitFromId` migration (nullable self-ref on Reservation) +
  lineageLink executor in `runSplit` (follow migrations.md: migrate:local → integration →
  migrate:test before main push; update each app's `__mocks__/@repo/data/PrismaCient.ts`
  if the mock models reservations' fields).
- **Then:** slice (d) credit-note invoice (design against payment.ts invoice core,
  track 015); then P3 — generate the matrix driving partner actions through table
  expectations (red cells for un-migrated actions) and start P4 migration (first targets:
  markDeparted split path + unreserveItem — the B1/B2 cells — then the newly-found
  frontdesk/actions.ts + partner reservations/[id]/actions.ts fossils, D14/D15).
- **Context needed:** `018-state-machine-intended.md` (contract);
  `packages/data/src/reservation-machine.ts` (pure model) +
  `reservation-machine-apply.ts` (interpreter); `018-state-machine-defacto.md` for
  current action behavior (file:line anchors).
- **Still pending (empirical, non-blocking):** (a) B1's "all 4 beds offered Collect" —
  whole-depart via tap-dialog Group mode vs a second derivation bug; (b) D5
  delete-on-abandon behavior for a demo paymentRef.
- **Blocked by:** nothing.

## Bug ledger (findings drive the model; each becomes a red matrix cell)

- **B1 — split-then-depart drops the till/settled linkage** (founder repro 2026-08-11).
  4-bed cash walk-in → one reservation R0 + ONE `TillEntry(R0, 4-seat amount)` + cash
  receipt invoice (4 seats). Multi-select 2 beds → bulk Depart → split path
  (`markDeparted` + `splitItemIds`, actions.ts:652-764): peels seats into new reservation
  R1 and conserves `paymentAmount` (R0 reduced, R1 gets subset) — but **TillEntry and the
  receipt invoice are never split/re-linked**. Consequences:
  - R1 has no tillEntries → grid/BedDetail read `settled=false` → beds render UNPAID and
    offer **Settle + Collect payment (QR)** after re-seat (multiday `expected` leg →
    `resumeWalkIn`) → **double-charge path** (Collect = real Mollie charge + PARTNER+
    PLATFORM invoices on top of already-collected cash).
  - Same-day variant: R1 departs → stay-over rule frees beds → re-entry is a brand-new
    walk-in that asks for payment again (no memory the seats were paid).
  - R0 drift: TillEntry amount (4 seats) vs `paymentAmount` (2 seats) — Unreserve of R0
    voids the FULL 4-seat entry while the confirm dialog shows/refunds `paymentAmount`
    (2 seats); per-worker till itemization overstates R0.
  - Receipt invoice stays at 4 seats on R0 forever.
  - Founder observed Collect offered "for all 4 beds"; static trace explains the 2 peeled
    beds — verify empirically whether the other 2 (R0, settled) also offer it, or whether
    the depart ran whole-reservation (tap-dialog Group mode does).
- **B2 — Seat-mode unreserve claims a refund but voids nothing** (2026-08-11 session).
  Multi-seat cash walk-in, Seat mode: `unreserveItem` disconnect branch never voids
  (by design — settlement belongs to remaining seats) but `BedDetail` confirm shows
  `confirmUnreserveRefund` with the WHOLE reservation's `paymentAmount` ("removed from the
  till; hand the cash back") whenever `settled` — wrong copy, wrong amount, no till effect.
- **B3 — unreserve orphans the cash receipt invoice.** `unreserveItem` voids TillEntry +
  deletes the reservation; `Invoice.reservationId` SetNulls and the PARTNER receipt
  (issued at settle, track 015) survives → till and invoiced revenue disagree. Needs a
  credit-note/void story (track 015 deferred "cash refund → credit-note").

## Roadmap

- ✅ **P0 — Extract the de facto machine** (2026-08-11). Deliverable:
  `018-state-machine-defacto.md` — 7 state components, kinds K1–K7, full transition
  inventory (partner manage + consumer payment paths + cron), divergences D1–D13.
- ✅ **P1 — Design the intended model** (2026-08-11). Review session held, all forks
  decided (`018-state-machine-intended.md` §6); **founder signed off on the table**
  (after clarifying the collect-abandon rule — abandon unwinds the payment attempt only,
  never occupancy; freeing is always an explicit Unreserve).
- ▶ **P2 — Encode structurally.** Slice 1 SHIPPED 2026-08-11: pure model module
  `packages/data/src/reservation-machine.ts` (exported as `@repo/data/reservation-machine`;
  client-safe, no prisma — the DB interpreter is a separate server module by design, see
  memory `project_repo_data_client_safe_exports`): `deriveState` (K1–K7 tuples incl.
  paid-in-cash overloads + collect phases + release rule), `TRANSITIONS` table as data
  (46 rows, reject-by-omission), `resolveTransition`, `partitionAmount` (largest-remainder,
  sum-preserving). 37 tests green (`reservation-machine.test.ts` — derive mappings, allowed
  cells, D5/D6/D10/I4 reject cells, table properties, partition math); data suite 318 green,
  lint clean. Slice 1 committed `608bc55`.
  Slice 2 (a) SHIPPED 2026-08-11 (uncommitted): server interpreter
  `packages/data/src/reservation-machine-apply.ts` (`@repo/data/reservation-machine-apply`,
  server-only) — `applyTransition(reservationId, event, opts)`: load → deriveState →
  resolveTransition (typed rejection) → effect executors. Implements dayRow (day-row +
  parent mirror + status, atomic, P2002-retried — duplicates partner reservation-day.ts
  semantics until P4 unifies), deleteRow (I4 defense: ANY till/invoice history incl.
  voided blocks delete), tillRecord/tillVoid/tillPartition (void+recreate preserving
  settledAt/employee), receiptIssue (non-blocking), creditNoteIssue STUB (logs until
  slice d), conflictRecheck (venue-local, self-excluding), and the composite split
  (seatPartition+amountRepartition+tillPartition+dayRowClone in one tx; lineageLink TODO
  until slice c). Conditions are FACTS computed by the interpreter (hasFutureDays,
  sameCivilDay, expired, stale*, subset) — callers supply only intent (itemIds, cash,
  amount, employeeId). Rows needing unbuilt executors (mollie*, creates) return
  `unsupported`, never half-run. Pure module gained `storageForState`/`opForOcc`
  (writer = reader's inverse, same file). 15 integration tests green incl. the B1
  end-to-end regression (split settled party → peeled reservation derives settled →
  collect.start AND re-settle both rejected) + I4 (voided-history row survives cron.gc).
  Data 318u + 320i green, lint clean.
  **Remaining P2 slices:** (b) meta-guard source-scan test (no state writes outside the
  machine); (c) additive `splitFromId` migration + lineageLink executor; (d) credit-note
  invoice support (Q4, extends track 015).
  **Determinism contract (LLM-analyzability — the design goal; non-negotiable):**
  1. *Reified state:* one exported `deriveState(reservation) → CompoundState`; grid
     (`bed-state.ts`), guards, and tests all call it — no per-consumer re-derivation
     (`todayStatus ?? operationalStatus`, `tillEntries.length > 0` inline, …).
  2. *Single writer, enforced:* no state-field `prisma.reservation.update/delete` outside
     `applyTransition` — meta-guard source-scan test (no-inline-money / coverage-contract
     pattern) fails on bypass. A bypassable table is drift-prone documentation.
  3. *Effects as data:* table rows declare named effect keys (`splitTillProportional`,
     `voidTill`, `issueReceipt`, `upsertDayRow(...)`) run by a small interpreter — never
     imperative per-transition blobs. "What does X do to the till" = read a cell.
  4. *Mechanical verification:* tests + property checks generated FROM the table
     (undefined cells, unreachable states, conservation sums) — analysis is lookup +
     proof, never code-path simulation. (Plain typed table over XState/TLA+ — no library
     semantics for future sessions to learn; auth-matrix is the in-repo precedent.)
- ☐ **P3 — Matrix tests generated from the table** (auth-matrix pattern). Bug ledger
  entries land as failing cells first.
- ☐ **P4 — Migrate actions onto the machine + fix red cells** (B1 till/receipt
  conservation on split, B2 copy/void mismatch, B3 credit-note or delete-blocks-receipt).
- 💤 **P5 — Wiki page** (`subsystems/reservation-state-machine.md`) + fold into
  `bed-state.ts` docs; groom CLAUDE.md pointers.

## Open decisions

**All resolved 2026-08-11 (P1 review) — record lives in `018-state-machine-intended.md` §6.**
Q1 → re-seatable (resume-undo, conflict recheck). Q2 → till partition (void + recreate,
settledAt/employee preserved). Q3 → `@repo/data`. Q4 → credit note. Q5 → sunbeds first.
Plus: D5 abandon never deletes; D10 check-in requires `complete`; D12 → money-rows-kept
deletable rule; D13 grouping kept; kind derived not persisted; no new status strings.

## Log

- **2026-08-11 (P2 slice b — meta-guard)** — Slice 2 committed (`28a4cb4`). Single-writer
  ratchet shipped: `packages/data/src/reservation-machine-guard.test.ts` scans all apps +
  data src for reservation state writes (update touching state fields; any delete; any
  ReservationDay write) outside 5 sanctioned machine/executor modules; exact-equality
  allowlist, shrink-only. Snapshot: 36 legacy sites across 9 files. **The scan found two
  writer files P0 missed** — `frontdesk/actions.ts` (pre-track-012 fossil: parent-only
  writes, no day-rows, terminal-only depart — D14) and partner
  `reservations/[id]/actions.ts` (D15) — recorded in the defacto doc §4b; both P4 targets.
  Validates determinism contract #2: bypasses are now build failures. Uncommitted. Fable 5.
- **2026-08-11 (P2 slice 2 — interpreter)** — Slice 1 committed (`608bc55`). Interpreter
  shipped: `@repo/data/reservation-machine-apply` executes the table against the DB.
  Design choices worth remembering: conditions are interpreter-computed FACTS (callers
  can't lie about hasFutureDays/sameCivilDay/subset); unimplemented effects (mollie*,
  creates) return `unsupported` — a row never half-runs; I4 defense counts VOIDED till
  entries as history (refund audit) so refunded rows survive GC; day-row writer is a
  deliberate duplicate of partner reservation-day.ts until P4 unifies (data can't import
  apps/*). B1 now has an end-to-end DB regression test: split a settled 4-seat party →
  peeled reservation still settled → collect + re-settle both rejected. 15 integration
  tests; data 318u+320i green. Uncommitted. Fable 5.
- **2026-08-11 (P1 sign-off + P2 slice 1)** — Founder clarified collect-abandon (payment
  events touch only the payment axis; occupancy changes need an occupancy gesture — "one
  gesture, one state change"), then signed off the table. P2 begun: pure model shipped as
  `@repo/data/reservation-machine` (deriveState + 46-row TRANSITIONS + resolveTransition +
  partitionAmount; client-safe, prisma-free — interpreter deliberately split into a future
  server module per the client-safe-exports rule). 37 new tests; data 318 unit green, lint
  clean. Kind stays derived; no new status strings (Claude calls, reversible). Fable 5.
- **2026-08-11 (P1 review)** — Interactive D-list walkthrough with founder; four forks
  decided (till partition · credit notes · money-rows-kept · departed re-seatable), stated
  recommendations accepted unvetoed (D5/D10/D13/Q3/Q5). Intended model drafted:
  `018-state-machine-intended.md` — state tuple (kind/pay/occ/ctx via single deriveState),
  invariants I1–I7, full transition table with named effect keys, reject-by-omission
  semantics, D-list disposition, P2 notes (one additive schema touch: `splitFromId`).
  Awaiting founder sign-off on the table to close P1.
- **2026-08-11 (later)** — P0 done: full de facto extraction shipped as
  `018-state-machine-defacto.md`. Key discoveries beyond B1–B3: `status=paid-in-cash` is
  overloaded across 4 kinds (walk-in/comp/block/settled-variants) making guards kind-blind
  (D4/D10/D11); THREE split paths share B1's non-conservation (depart-split, collect-split
  `splitWalkInSeat`, hold-convert-split); `cancelCollection` deletes occupied-seat
  reservations against its own docstring (D5); guards read two different "current state"
  notions (parent vs today-row, D7/D9); availability guard uses server-TZ + parent op while
  grid uses venue-TZ + today-row (D8, overlaps track 017). Motivation section added to Goal
  (founder: regain control of validation/testing/maintenance). Fable 5 session.
- **2026-08-11** — Track opened after founder repro of B1 (split-depart → re-seat →
  "Collect payment" offered again). B1 traced to the split transaction conserving
  `paymentAmount` but not TillEntry/receipt-invoice linkage; B2/B3 carried over from the
  2026-08-11 unreserve-vs-depart analysis. Plan: extract → design (founder gate) →
  encode → matrix tests → migrate. Fable 5 session.

## Links

- [[track:012-multiday-per-day-operational-state]] — ReservationDay / daily cycle / stay-over
- [[track:013-settlement-ledger-till]] — TillEntry ledger ("settled" derivation)
- [[track:015-cash-sale-receipts]] — cash receipt invoices (B3, Q4)
- [[track:016-day-anchored-till]] — day-anchored till windows
- [[track:011-group-multiselect-reservation]] — grouped create (feeds multi-seat states)
