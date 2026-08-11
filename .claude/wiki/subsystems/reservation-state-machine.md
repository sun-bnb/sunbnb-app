---
type: subsystem
slug: reservation-state-machine
status: stable
sources:
  - packages/data/src/reservation-machine.ts
  - packages/data/src/reservation-machine-apply.ts
  - packages/data/src/reservation-machine-guard.test.ts
  - apps/partner/app/sites/[id]/manage/state-machine-matrix.integration.test.ts
  - apps/partner/app/sites/[id]/manage/bed-state.ts
  - .claude/tracks/018-state-machine-intended.md
  - .claude/tracks/018-state-machine-defacto.md
related:
  - subsystem:payments
  - subsystem:employee-till
  - entity:reservation
last_verified: 2026-08-11
---

# Subsystem: Reservation State Machine

The explicit, table-driven state machine behind every sunbed-reservation transition
(track 018). Built because reservation "state" had become a compound derived ad-hoc at
every consumer — producing the B1 double-charge family — and the founder had lost
control of validation/testing/maintenance. The design goal is **deterministic
LLM-analyzability**: state questions are table lookups, never code-path simulation.

## The model

`deriveState(input) → (kind, pay, occ, released)` — the ONE derivation
(`@repo/data/reservation-machine`, pure + client-safe).

- **kind** (derived, not stored): `online · walkin · hold · comp · block`. Disambiguates
  the overloaded `paid-in-cash` status (used in storage by walk-ins, comps, AND blocks).
  A QR-collect is a *phase of walkin* (`processing|complete` + walked-in), not a kind.
- **pay**: online → `pending…refunded` (the status strings); walkin →
  `unsettled | settled | collecting | collected | refunded` where **settled ⇔ ≥1
  non-voided TillEntry** (payment evidence is part of state, the B1 root-cause fix).
- **occ** (venue-local today): `expected | present | departed | no-show` — today's
  `ReservationDay` row wins over the parent column; `blocked` reads parent only.
- **released**: `(departed | no-show) ∧ stayOver` — the one bed-freeing rule, shared by
  grid, guards, and availability.

## The four determinism pillars

1. **Reified state** — `deriveState` is the only derivation; the partner grid's
   `bed-state.ts` is a presentation shell over it.
2. **Single writer** — `applyTransition` (`reservation-machine-apply.ts`, server-only)
   is the only state writer; `reservation-machine-guard.test.ts` scans ALL apps and
   fails the build on bypasses (exact-equality, shrink-only allowlist; residue: the
   I4-filtered cron sweep + the manage create-verbs batch).
3. **Effects as data** — every `TRANSITIONS` row lists named effect keys
   (`tillPartition`, `creditNoteIssue`, `dayRow`, `mollieCancel`…); executors run them.
   "What does X do to the till" = read the row.
4. **Mechanical verification** — pure table-property tests (deletes provably confined
   to zero-money states; every occ/kind change carries `dayRow`) + the partner
   **matrix** driving REAL actions with `resolveTransition` as the oracle. Bug-ledger
   cells were `it.fails` red until their migration flipped them (never deleted).

## Conservation invariants (I1–I7, tested)

- **I1** till: splits partition seats + `paymentAmount` + TillEntry together
  (`partitionAmount`, largest-remainder cents; void + recreate preserving
  settledAt/employee). Lineage via `Reservation.splitFromId`.
- **I2** receipts: Σ receipts − Σ credit notes ≡ Σ non-voided till over a lineage.
  Cash refunds issue `PARTNER-CN-…` credit notes (`issueCashCreditNote`); receipts are
  immutable (hash chain).
- **I4** deletable rule: a row that ever produced money evidence (ANY TillEntry —
  voided included — or invoice) is NEVER hard-deleted; it terminates in a status.
  Enforced in the executor AND as a cron-sweep query filter.
- Others: seat partition (I3), single writer (I5), one venue-local clock (I6),
  DB-priced amounts (I7).

## Decisions that shape behavior (founder, P1 review 2026-08-11)

- Settled unreserve ALWAYS refunds (keeping money is Depart's job) — row kept as
  `refunded` + till void + credit note.
- Same-day departed cash walk-ins are re-seatable (`staff.resume.undoDepart`, conflict
  re-checked; `undoDepartWalkIn` + BedDetail's FREE-panel button).
- "One gesture, one state change": payment events (e.g. `collect.abandon`) may only
  touch the payment axis — abandoning a QR can never free a bed.
- `pay.fail` resolves collect-vs-online reverts BY STATE (webhook `metadata.collect` is
  not load-bearing). `user.delete` rejects PROCESSING bookings (in-flight payment could
  land as an orphaned charge).
- Kind stays derived (no column); no new status strings (cash refund reuses `refunded`,
  `paymentRef == null` ⇒ cash).

## Extending it

Add/change a transition by **editing the table** (+ its executor if a new effect key),
then: pure tests assert the table, the matrix drives the action, the meta-guard forces
the allowlist DOWN when an action migrates. Never add a guard or a state write inside an
action. Interpreter conditions are computed facts — callers pass intent only
(`itemIds`, `cash`, `amount`, `buildRedirectUrl`, `refund`).

## Pitfalls

- The interpreter's day-row writer deliberately duplicates partner
  `reservation-day.ts` semantics (data can't import apps/*) — unify when the partner
  module delegates.
- `collected` walk-ins converge to `online·complete` once their multiday stay cycles
  to `expected` — deliberate, documented in `deriveState`.
- Rental bookings and table reservations have PARALLEL machines not yet modeled —
  same rails later (track 018 Q5).
- Unit tests mock ONLY the interpreter (`reservation-machine-apply` → `__mocks__`);
  the pure model is always aliased to real source.

## Cross-refs

[[subsystem:payments]] — invoices/credit notes the effects create ·
[[subsystem:employee-till]] — the TillEntry ledger the pay axis derives from ·
[[entity:reservation]] — the stored shape under the compound state.
