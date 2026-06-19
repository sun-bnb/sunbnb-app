---
id: 009-anonymous-equipment-rentals
title: Anonymous Equipment Rentals
status: proposed
created: 2026-06-19
updated: 2026-06-19
worktree: null
---

## Goal

Bring **equipment rentals** to full parity with the bearer-model **anonymous (`anonId`)**
flow that sunbed reservations already have — so a guest can **book, pay for, and re-find** an
equipment rental via the consumer app / POS / QR **without logging in**, with the same identity,
ownership, payment, lookup, and email semantics.

**Reference pattern (anon sunbed):** `anonId` is a UUID in `localStorage('sunbnb-anonId')`,
passed by query (GET) or body (POST). `saveReservationForMultipleItems` stores the **site owner's
`userId` as an FK placeholder** and the real customer in `anonId` (+ optional `guestEmail`);
ownership is checked via `getRequestIdentity(request, bodyAnonId)` + `verifyOwnership(identity,
entity)` (`apps/user/app/api/_lib/auth.ts`) on the anon-or-session identity; payment is Mollie or
demo, with `anonId` threaded through the `&anonId=` redirect to `/payment/complete`; re-find via
`findAnonReservation`; emails go to `anonId ? guestEmail : user.email`.

**The gap (rental side, mapped):**
| Touchpoint | Sunbed anon | Rental today |
|---|---|---|
| `RentalBooking.anonId` / `guestEmail` | ✓ on `Reservation` | ✗ **absent (schema gap)** |
| Booking create accepts `anonId` | ✓ `saveReservationForMultipleItems` | ✗ `saveRentalBooking` is **auth-only** |
| Mollie payment ownership check | ✓ `verifyOwnership(identity, res)` | ✗ rental route checks `userId` only — **latent bug** |
| Demo payment anon | ✓ `initiateDemoReservationPayment(id, anonId)` | ✗ `initiateDemoRentalPayment` **auth-only** |
| Anon re-find | ✓ `findAnonReservation` | ✗ **no `findAnonRental`** |
| `GET /api/<entity>/[id]` anon | ✓ threads `anonId` | ✗ `/api/rental-bookings/[id]` **auth-only** |
| Confirmation email | ✓ `sendConfirmationEmail` (guestEmail) | ✗ `processConfirmedRentalBooking` sends **none at all** |
| Consumer anon UI / POS entry | ✓ `/sites/[id]/pos` | ✗ equipment tab **requires auth** |

Partner walk-in (`createWalkInRental`) is on-site/staff-attributed — **out of scope** (matches
`reserveItem`, which also isn't anon).

## Resume here

- **Next action:** Phase 1 — `saveRentalBooking` accepts `anonId?` + `guestEmail?`; drop the
  auth-hard-fail; site-owner FK placeholder; adopt `createRentalBookingsWithGuard`. `user-dev`.
  Schema migration (Phase 0) applied locally + to `sunbnb_test`; pending `migrate:test` before
  pushing `main` (per `.claude/rules/migrations.md` pre-push hook).
- **Context needed:** reference = `Reservation` anon fields (`schema.prisma` ~387–418) +
  `saveReservationForMultipleItems` (`apps/user/app/sites/[id]/actions.ts` ~28–191, the
  site-owner-FK trick at ~91–100, the guard call at ~168–179). Rental side: `RentalBooking`
  (`schema.prisma` ~630–655), `saveRentalBooking` (~195–313), the rental Mollie route
  (`apps/user/app/api/payment/mollie/create-rental-payment/route.ts`, ownership bug ~78–82),
  `initiateDemoRentalPayment` (`apps/user/app/payment/actions.ts` ~144), `processConfirmedRentalBooking`
  (`packages/data/src/payment.ts` ~715–827), `GET /api/rental-bookings/[id]`. The `createRentalBookingsWithGuard`
  transactional guard already exists in `@repo/data/reservations` (built in track 004 Phase 2).
- **Blocked by:** —

## Roadmap

Schema + payment-core + cross-app (packages/data + apps/user) → this is an **architecture pass**
(`.claude/rules/architecture.md`, `migrations.md`, `payments.md`). Each phase carries its own
tests, bug-revealing where it touches ownership/money (the track-004 discipline).

- ☑ **Phase 0 — Schema (expand migration; data-dev).** Add the **same anon fields `Reservation`
  carries** to `RentalBooking` — `anonId String? @map("anon_id")`, `guestEmail String?
  @map("guest_email")`, and `guestContact String? @map("guest_contact")` (all nullable →
  backward-compatible expand). Migration `20260619090109_rental_booking_anon_fields` applied to
  local + `sunbnb_test`. 102/102 integration tests pass. No mock changes needed.
- ☐ **Phase 1 — Anon booking creation (user-dev).** `saveRentalBooking` accepts `anonId?` +
  `guestEmail?`; validate `anonId` (UUID, ≤36 chars); drop the auth-hard-fail; when no session,
  set `userId` = site owner (FK placeholder) and store `anonId` + `guestEmail` — mirror
  `saveReservationForMultipleItems`. Prices stay DB-sourced. **Adopt `createRentalBookingsWithGuard`**
  (race-safe transactional create) so the anon path mirrors the sunbed guard and closes the
  user-app rental race in one move. Tests: anon create (unit + integration) — anon sets
  anonId+owner-FK+guestEmail; auth path unchanged.
- ☐ **Phase 2 — Anon payment (user-dev).** Replace the rental Mollie route's `userId`-only check
  with `verifyOwnership(identity, booking)` (now that `booking.anonId` exists) — **fixes the latent
  bug**. `initiateDemoRentalPayment` accepts + validates `anonId`, verifies session-or-anonId match
  (mirror `initiateDemoReservationPayment`). Thread `anonId` through the `&anonId=` redirect and the
  `/payment/complete` rental path. Tests: foreign-anonId rejection (bug-revealing), demo anon path.
- ☐ **Phase 3 — Anon lookup/retrieval (user-dev).** Add `findAnonRentalBooking(anonId, …)` (mirror
  `findAnonReservation`). `GET /api/rental-bookings/[id]` uses `getRequestIdentity(request,
  bodyAnonId)` + `verifyOwnership`. `/payment/complete` rental rendering verifies via `anonId`.
  Tests: anon lookup + the API route's anon ownership, incl. a real-DB **cross-anon isolation**
  integration test (another anon's booking is not returned).
- ☐ **Phase 4 — Email parity (data-dev).** Mirror the sunbed email set for rentals — the sunbed
  flow sends confirmation (`sendConfirmationEmail` after `processConfirmedReservation`), reminder
  (`sendDueReminders` cron), and cancellation, all to `anonId ? guestEmail : user.email`
  (`loadReservationEmailData`). Rentals today send **none**, so add the rental-equivalent of each
  (confirmation from `processConfirmedRentalBooking`, reminder, cancellation) + rental email
  templates, with the same recipient-selection rule. Tests: recipient selection + email-sent.
- ☐ **Phase 5 — Consumer UI / anon entry (user-dev).** The equipment booking UI
  (`EquipmentSelection` / equipment `viewMode`) reads `anonId` from `localStorage('sunbnb-anonId')`
  and books anonymously like the sunbed POS flow; `/payment/complete` renders the rental result
  with `anonId`. *(Open: a dedicated QR/POS rental entry like `/sites/[id]/pos`, or just the
  in-app equipment tab going anon?)*

## Design principle — faithful mirror (no open decisions)

Per the alignment directive (2026-06-19): this track does **exactly what the anon-sunbed flow
does**, with the rental equivalent at each touchpoint — no optional forks, no scope re-litigation.
The earlier "open decisions" are all resolved *by alignment*, not by preference:
- **Race guard → yes.** Sunbed `saveReservationForMultipleItems` creates through
  `reserveWithConflictGuard`; rentals create through `createRentalBookingsWithGuard` (the
  rental-equivalent guard, already built).
- **Emails → yes, all of them.** Sunbeds send confirmation + reminder + cancellation; rentals mirror
  each, same `anonId ? guestEmail : user.email` recipient rule.
- **`guestContact` → yes.** `Reservation` carries it, so `RentalBooking` gets it too (Phase 0).
- **Anon entry → mirror the sunbed consumer/POS-QR entry**, not a new design (Phase 5).

## Log

- **2026-06-19** — Track proposed. Two-explorer mapping completed: the anon-sunbed reference flow
  (every touchpoint, file:line) and the rental gap table (above). Key findings folded into the
  Goal/Roadmap: the schema is the foundation (RentalBooking lacks `anonId`+`guestEmail`); the rental
  Mollie route already *accepts* `anonId` from the body but its ownership check ignores it (latent
  bug, fixed in Phase 2); rentals send no confirmation email at all (parity gap, Phase 4); the
  `createRentalBookingsWithGuard` transactional guard from track 004 Phase 2 is available to adopt
  in Phase 1.
- **2026-06-19** — Alignment directive: keep the plan a **faithful mirror** of the anon-sunbed
  flow. Dropped the "recommended/optional/scope-out" framing — the four former open decisions are
  resolved by alignment (guard yes, all emails yes, `guestContact` yes, anon entry mirrors the
  sunbed POS/QR). The plan adds nothing sunbeds don't have and omits nothing they do. Not started.
- **2026-06-19** — Phase 0 complete. Migration `20260619090109_rental_booking_anon_fields` adds
  `anon_id TEXT`, `guest_email TEXT`, `guest_contact TEXT` (all nullable) to `RentalBooking`.
  Applied to local Docker DB + `sunbnb_test` (lockstep). 102/102 integration tests pass. No app
  mock changes needed (mocks are operation-level `vi.fn()` stubs, not field-enumerating). Pending
  `migrate:test` (Neon test DB) before pushing `main` — the pre-push hook will enforce it.

## Links

Mirrors the anon-sunbed flow end-to-end; reuses `@repo/data/reservations` patterns and the
`createRentalBookingsWithGuard` guard from [[track:004-partner-test-architecture]] (whose testing
discipline — bug-revealing, integration isolation tests — applies here). Consumer payments are
Mollie + demo only (see [[track:003-stripe-connect-compliance]]). Touches `[[entity:rental]]`,
`[[entity:reservation]]`, `[[entity:invoice]]`, and the consumer booking/payment flow.
