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

- **Next action:** commit P4 slice (g) — docs/wiki sync (awaiting founder's word).
  That closes the track's built scope: P0–P3 done, P4 slices 1/2/3/e/f/g done,
  browser-verified.
- **Founder ops before promote:** ES/FI copy review (`undoDeparture`,
  `confirmUnreserveSeatRefund` + earlier session keys); **`npm run migrate:test`
  before the next `main` push** — TWO additive migrations pending on the shared test
  DB (`20260811164614_add_reservation_split_lineage`,
  `20260811165223_add_invoice_credit_note_link`); the pre-push hook enforces.
- **Queued follow-up batches (backlog, not started):** manage create-verbs +
  move/cancel/refund onto machine events (allowlist 8 → 0); rental-booking and
  table-reservation machines on the same rails (Q5); partner reservation-day.ts
  delegates to the interpreter's day-row writer (removes the deliberate duplication).
- **Deferred nits:** no index on `split_from_id` (rare lookups; add forward if hot);
  accounting/fiscal surfaces should eventually RENDER credit notes distinctly (they
  already net correctly in sums).
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
  Slice (b) meta-guard committed `7a54f75`; slice (c) split lineage committed `f391988`.
  Slice (d) SHIPPED 2026-08-11 (uncommitted): credit notes. Additive migration
  `20260811165223_add_invoice_credit_note_link` (`credits_invoice_id` self-ref + index on
  Invoice). `issueCashCreditNote(reservationId, {amount?, invoicedAt?})` in payment.ts —
  a credit note is a NEGATIVE-total PARTNER invoice in its own number series
  (`PARTNER-CN-YYYY-NNNNN`, via a `series` param on nextInvoiceNumber) sharing the
  issuer's Veri*factu hash chain, linked via creditsInvoiceId; VAT reverse-computed at
  the RECEIPT's effective rate (survives site-VAT changes); partial credits accumulate
  and cap at the receipt total (balance re-checked inside the numbering-locked tx).
  Negative totals mean existing PARTNER revenue aggregations net refunds automatically.
  Interpreter's creditNoteIssue executor is real (non-blocking, 'no-receipt' is a normal
  logged skip). User-app payment mock updated (mock-superset). 6 new credit-note
  integration tests + machine-level I2 end-to-end (settle→receipt, unreserve→CN,
  lineage invoice sum 0 ≡ empty till). Data 320u+327i, user 478u green; migrate:check
  clean. **P2 COMPLETE once (d) is committed.**
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
- ▶ **P3 — Matrix tests generated from the table.** Initial matrix SHIPPED 2026-08-11
  (uncommitted): partner integration test
  `app/sites/[id]/manage/state-machine-matrix.integration.test.ts` (17 tests) drives the
  REAL manage actions through table expectations — post-states come from
  `resolveTransition`, never hand-written. **10 GREEN cells** (walkIn cash/card, settle,
  depart lastDay/multiday, resume, checkIn, noShow, hold+release, convert-cash) lock
  current-correct behavior; **6 RED cells** as `it.fails` (B1a/B1b peeled-party settled +
  till partition, B1c splitWalkInSeat, D12/I4 refund-unreserve row-kept+credit-note, D2
  seat-unreserve till partition, D10 check-in-on-hold) — they PASS while the bugs exist
  and flip the build when P4 fixes each action, forcing the cell to green. Coverage
  manifest: every table event classified COVERED (13) or DEFERRED-with-reason (21,
  shrink-only) — a new table event fails the manifest until classified. Partner 1996u +
  196i green (17 new), tsc + lint clean.
- ▶ **P4 — Migrate actions onto the machine + fix red cells.** Slice 1 SHIPPED
  2026-08-11 (uncommitted): `unreserveItem`, `markDeparted` (whole + split),
  `splitWalkInSeat`, `checkInReservation` swapped onto `applyTransition` — **all six
  matrix red cells flipped GREEN on first run** (B1a/B1b/B1c till-follows-seats, D12
  refund-unreserve row-kept+credit-note, D2 seat-partition, D10 kind-guarded check-in).
  Meta-guard ALLOWLIST manage/actions.ts 19 → 13 (first ratchet shrink). Legacy
  `voidSettlements` param retained-but-ignored (refund is state-derived; documented).
  actions.test.ts stale internals suites rewritten to the machine-delegation contract
  (368 green; two obsolete suites replaced with a pointer note); two integration tests
  updated to the decided semantics — one had enshrined the old split recompute that
  INVENTED money (guest paid €30, books said €60; now partitions the actual €30).
  Partner 1978u+196i, data 320u+327i, tsc clean.
  Slice 2 SHIPPED 2026-08-11 (uncommitted): **D14/D15 fossils migrated** — frontdesk +
  partner reservation-detail check-in/depart/no-show/cancel now delegate (parent-only
  writes and terminal-only depart deleted; frontdesk gains the multiday daily cycle;
  cancel is machine-guarded to online·complete — cash walk-ins rejected with pointer to
  Unreserve; cancellation email stays action-owned, fired only on applied).
  **markNoShow/resumeWalkIn delegated; NEW `undoDepartWalkIn` action** (staff.resume.
  undoDepart — same-civil-day undo with conflict recheck; registered in gated-actions,
  auth-matrix picks it up; UI button still pending → slice d). **Cron I4 sweep**: the
  cleanup deleteMany now carries `tillEntries: {none:{}} + invoices: {none:{}}` — money
  rows structurally survive GC. Vestigial dayRow effect removed from partner.cancel
  table rows. Ratchet: frontdesk 4→0, reservation-detail 4→0 (allowlist entries
  deleted). Fossil test files rewritten to delegation contracts (69 green); matrix
  +2 undo-depart cells (19 total), staff.resume.undoDepart DEFERRED→COVERED.
  Partner 1966u+198i, data 320u+327i green, tsc clean.
  Slice 3 (UI) SHIPPED 2026-08-11 (uncommitted, primed via /ui partner):
  **bed-state.ts is now a presentation shell over deriveState** (determinism contract
  #1 closed for the grid — same derivation as the interpreter's guards; one deliberate
  presentation change: impossible tuple paid-in-cash+checked-in now renders walked-in,
  kind-authoritative). **Undo-departure button** in BedDetail's FREE panel (↩ +guest
  name, restorative so no confirm; visible when `findUndoDepartCandidate` finds a
  released same-day-departed cash walk-in; server enforces same-day + conflict).
  **B2's UI half fixed:** Seat-mode unreserve dialog shows the freed seat's PARTITIONED
  share (`freedSeatShare` — same partitionAmount as the interpreter, seat-price
  weights); Group mode shows the actual non-voided till total (`settledTotal`), not
  paymentAmount. Grid query now selects party `items {id, price}` (Reservation.items
  type narrowed to the minimal shape). New pure helpers unit-tested (8 tests).
  **i18n: 2 new keys × 3 locales** (`undoDeparture`, `confirmUnreserveSeatRefund`) —
  ES/FI machine-drafted, FOUNDER COPY REVIEW before promote. Partner 1974u+198i, tsc
  clean. **BROWSER-VERIFIED 2026-08-11** (verifier-sunbnb, real dev DB, screenshots
  /tmp/v018-*.png): cash party → red seats with € glyph (deriveState grid); Seat-mode
  Unreserve dialog showed the PARTITIONED €8.50 (party till €17) — confirmed → till
  void+recreate trail + `PARTNER-CN-2026-00001` credit note (first CN in the wild) +
  paymentAmount 17→8.5; depart → green; FREE panel showed "↩ Undo departure —
  Verify018" → click re-seated (red, € intact, till untouched). Test rows cleaned;
  verifier skill recipe updated (grid route /manage/sunbeds; paid bulk sheet forks
  Cash/Card directly).
  Slice (e) SHIPPED 2026-08-11 (uncommitted): **collect flow migrated — D5 and D6 both
  closed at the ACTION level.** Interpreter gained the payment-rail executors:
  `runCollectStart` (amountFromDb walk-in pricing → mintAnonId → demo ref | Mollie
  create via reservation-payment helper; provider failure reverts to unsettled cash —
  never stranded; the redirect URL embeds the MACHINE-minted anonId so the action
  passes a `buildRedirectUrl` builder in `opts.collect`), `runCollectAbandon`
  (reverifyOnce → paid race honestly reported as the pay.confirm ROW; else provider
  cancel + revert-to-cash — NEVER deletes/frees, D5), plus generic `invoiceOnline`
  (processConfirmedReservation) and the pay.fail revert via the standard tail.
  ApplyResult gained `data` payload + `effect-failed` variant (guards passed,
  provider failed, local state kept safe). Actions (`collectReservationPayment`,
  `getCollectStatus`, `cancelCollection`) are thin delegators; settled walk-ins now
  rejected by the MACHINE, not a hidden button (D6). Ratchet: manage/actions.ts
  13 → 8. 4 new machine integration tests (demo collect, config-failure revert,
  paid-race abandon → collected + invoices + seat never freed, pay.fail revert);
  collect unit suites rewritten to delegation contracts; matrix DEFERRED reasons
  updated (collect events machine-covered). Partner 1968u+198i, data 320u+331i, tsc
  clean.
  Slice (f) SHIPPED 2026-08-11 (uncommitted): **ALL user-app writer entries → 0.**
  Webhook fail/refund, poll + reconcile reverts, demo `pay.initiate`, and user
  cancel/delete delegate to applyTransition. Highlights: `pay.fail` resolves the
  collect-vs-online revert BY STATE (metadata.collect no longer load-bearing —
  webhook branch deleted); new table rows: `user.delete` (pending/failed/canceled
  only — PROCESSING is a reject cell, in-flight payments can no longer be deleted
  out from under; paid-then-canceled blocked by the I4 invoice defense) and
  `pay.refund.webhook` for QR-collected walk-ins (was silently unhandled);
  `user.cancel`'s providerRefund executes via a caller-supplied handler (provider
  abstraction stays app-side) BEFORE the status write — refund failure aborts the
  cancel; mid-payment cancels rejected. User test infra gained the machine mock +
  aliases; 9 stale write-assertions rewritten to delegation contracts. Allowlist
  now TWO entries total: cron (1, I4-filtered by design) + manage/actions.ts (8).
  User 478u+77i, partner 1968u+198i, data 320u+331i, tsc clean everywhere.
  Slice (g) SHIPPED 2026-08-11 (uncommitted): docs/wiki sync. packages/data/CLAUDE.md
  gained the Reservation State Machine section (+ issueCashCreditNote + test lists);
  partner CLAUDE.md (delegation notes, undoDepartWalkIn, matrix/bed-state/frontdesk
  test rows, corrected counts 1968u/198i, auth-matrix 669, mock-contract 17); user
  CLAUDE.md (machine notes, webhook 34, 478u/77i, machine mock). Wiki: NEW
  `subsystems/reservation-state-machine.md` (stable — model, four pillars, invariants,
  founder decisions, extension rule "edit the TABLE"), index line, log ingest record.
  **P4 = functionally complete.** Queued follow-up (not started): the final manage
  batch — creates/holds/blocks/comps/convert + move + partner cancel/refund onto
  machine events (allowlist 8 → 0), rentals + table-reservations machines on the same
  rails (Q5), unify partner reservation-day.ts onto the interpreter's day-row writer.
- ✅ **P5 — Wiki page + canonical docs** (2026-08-11, with P4 slice g):
  `subsystems/reservation-state-machine.md` (stable) + CLAUDE.md tree synced.

## Open decisions

**All resolved 2026-08-11 (P1 review) — record lives in `018-state-machine-intended.md` §6.**
Q1 → re-seatable (resume-undo, conflict recheck). Q2 → till partition (void + recreate,
settledAt/employee preserved). Q3 → `@repo/data`. Q4 → credit note. Q5 → sunbeds first.
Plus: D5 abandon never deletes; D10 check-in requires `complete`; D12 → money-rows-kept
deletable rule; D13 grouping kept; kind derived not persisted; no new status strings.

## Log

- **2026-08-11 (follow-up: honest Unreserve labels + bulk refund confirm)** — Founder
  call: the button says what the transition does. All four Unreserve entry points now
  label `settled ? "Refund" : "Unreserve"` (EN Refund / ES Devolver / FI Hyvitä — all
  strictly shorter than the existing Unreserve strings, no wrap risk); the bulk
  multiselect Unreserve — previously fire-on-tap — now routes through the ⚠ bulkConfirm
  showing the SUMMED refund (`selectionRefundTotal` in bed-state: per-party grouped
  partition, full total when a whole party is selected; 4 unit tests). Stale
  pre-migration comment in BedDetail fixed; legacy 5th arg dropped from callers.
  Partner 1972u+198i green. ES/FI drafts await founder review. Uncommitted. Fable 5.
- **2026-08-11 (P4 slice f — user-app writers at zero)** — Slice (e) committed
  (`64d039a`). Consumer surfaces on the machine: webhook/poll/reconcile reverts are
  one state-resolved `pay.fail` (the metadata.collect branch is DELETED — kind
  derivation replaced a wire-protocol flag); user.delete is a new table event with a
  real safety win (deleting a PROCESSING booking — whose payment could still land as
  an orphaned charge — is now a reject cell); QR-collected walk-in refunds get their
  webhook row (previously fell through silently). providerRefund pattern: caller
  supplies the handler, interpreter decides necessity + ordering. Allowlist: 7 files
  → 2. Fable 5.
- **2026-08-11 (P4 slice e — collect flow; D5+D6 dead)** — Slice-3 verification
  committed (`0d3548b`). The collect flow runs on the machine: settled walk-ins are
  machine-rejected (D6 was UI-only), abandon can never free an occupied bed (D5 —
  "one gesture, one state change" now enforced by the executor), a paid race is
  honestly reported as the pay.confirm row, provider failures revert to unsettled
  cash. Design note: the redirect URL embeds the machine-minted anonId, so the
  action passes a URL BUILDER through opts.collect — callers supply intent and
  context, never state. Ratchet 13→8. Fable 5.
- **2026-08-11 (P4 slice 3 — the UI slice)** — Slice 2 committed (`9072900`). Primed
  /ui partner. bed-state internals swapped for deriveState (grid and guards now share
  ONE derivation — the D8-class grid/guard divergence is structurally closed on the
  grid side); undo-departure button live in the FREE panel; unreserve dialog tells the
  truth (Seat → partitioned share via the same partitionAmount as the machine; Group →
  actual till total). One fixture correction in bed-state.test.ts: paid-in-cash+
  checked-in (impossible tuple) now renders walked-in — kind wins. 2 i18n keys × 3
  locales added (ES/FI await founder review). Browser verify pending. Partner
  1974u+198i, tsc clean. Uncommitted. Fable 5.
- **2026-08-11 (P4 slice 2 — fossils dead, undo-depart live, cron I4-safe)** — Slice 1
  committed (`4c386e4`, net −846 lines). The D14/D15 fossils are gone: frontdesk and
  reservation-detail transitions delegate to the machine (the frontdesk's terminal-only
  depart — which silently broke multiday stays — now cycles correctly). New capability
  from the P1 decision: `undoDepartWalkIn` (same-day undo, conflict-rechecked, till
  untouched) — action + matrix cells shipped; BedDetail button pending (slice d).
  Cron GC structurally cannot delete money rows anymore (I4 filter in the where).
  Allowlist: 9 files → 7 (both fossil entries deleted). Fossil unit suites rewritten to
  delegation contracts. Partner 1966u+198i, data 320u+327i. Uncommitted. Fable 5.
- **2026-08-11 (P4 slice 1 — first actions migrated, all red cells flipped)** — P3
  committed (`5de085b`). unreserveItem / markDeparted / splitWalkInSeat /
  checkInReservation now delegate to applyTransition; every one of the six matrix red
  cells went green ON FIRST RUN — the founder's B1 repro is fixed by construction (till
  partitions with seats; peeled parties stay settled; Collect/re-settle rejected).
  Ratchet shrank 19→13. Notable: the old split recompute INVENTED money (charged €30 →
  booked €60) — an old integration test had enshrined it; now asserts I1 partition.
  Legacy voidSettlements opt-out ignored per D2 decision. Unit suites rewritten from
  implementation-internals to machine-delegation contracts (this is the maintenance
  model now: actions assert WHICH event they name; behavior lives in table+interpreter
  tests). Partner 1978u+196i, data 320u+327i green. Uncommitted. Fable 5.
- **2026-08-11 (P3 — initial matrix)** — P2 committed complete (`29c5a68`). The matrix
  is live: real manage actions driven through table-derived expectations (tablePost via
  resolveTransition — the table IS the oracle). 10 green cells lock correct behavior;
  6 `it.fails` red cells encode B1a/B1b/B1c/D12/D2/D10 — each will break the build when
  its P4 fix lands, forcing the flip to green (bugs die visibly, never silently).
  Coverage manifest partitions all 34 events into COVERED/DEFERRED (exhaustive,
  disjoint, shrink-only). Founder's original repro is now a permanent CI artifact.
  Partner 1996u+196i, tsc+lint clean. Uncommitted. Fable 5.
- **2026-08-11 (P2 slice d — credit notes; P2 functionally complete)** — Slice (c)
  committed (`f391988`). Credit notes live: additive `credits_invoice_id` migration,
  `issueCashCreditNote` in payment.ts (negative PARTNER invoice, own `PARTNER-CN-` series
  via nextInvoiceNumber `series` param, shared hash chain, receipt-effective VAT, capped
  cumulative partials inside the numbering-locked tx), interpreter executor real. Q4 and
  the track-015 deferred item are both closed. I2 provable end-to-end: settle→receipt,
  refund-unreserve→CN, lineage invoice sum ≡ till ≡ 0. Data 320u+327i, user 478u green.
  All four P2 slices done — table, interpreter, ratchet, money-correction rail. Fable 5.
- **2026-08-11 (P2 slice c — split lineage)** — Slice (b) committed (`7a54f75`). Additive
  migration `20260811164614_add_reservation_split_lineage`: nullable `split_from_id`
  self-ref on Reservation (SetNull — a deleted origin is only ever a zero-money row per
  I4). Applied local + sunbnb_test lockstep; `migrate:check` clean; **migrate:test still
  pending before next main push**. `runSplit` now stamps `splitFromId` (lineageLink
  executor real); integration test asserts lineage. Data 320u+320i green. No index on
  split_from_id (deferred — rare lookups). Uncommitted. Fable 5.
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
