---
type: subsystem
slug: employee-till
status: draft
sources:
  - packages/data/prisma/schema.prisma#model-Employee
  - packages/data/src/till.ts
  - apps/partner/app/account/staff/actions.ts
  - apps/partner/app/sites/[id]/manage/actions.ts#resolveEmployeeId
  - apps/partner/app/sites/[id]/manage/TillSheet.tsx
  - apps/partner/app/sites/[id]/accounting/actions.ts#getStaffTill
  - .claude/tracks/008-employee-model.md
related:
  - flow:walk-in
  - entity:reservation
  - entity:settlement
last_verified: 2026-06-19
---

# Floor-staff attribution & per-worker till

Floor-staff identity for the partner manage page: a per-account **roster**, **automatic
attribution** of on-site transactions to a current worker, a **per-worker cash till** with a
shift-end "close my till", and a **manager monthly breakdown**. Built as track 008 (the Alonso
"Group A" gap); woven in minimally — no per-transaction input, no PIN, hidden entirely when the
account has no roster. Attribution is **orthogonal to authorization** (the `accessKey`/SecurityToken
gate on the manage page is unchanged; see [[subsystem:auth]]).

**Why it exists:** before this, every on-site transaction was stamped with the site *owner's*
`userId`, so a multi-worker venue couldn't tell who rang up what and had no daily cash
reconciliation (Sunbnb has only monthly [[entity:settlement]]). The leapfrog over Alonso: Alonso's
"employee" is a free-text name with a single per-device default that wipes at day-reset; Sunbnb does
a real roster + persisted attribution → durable cross-day reporting.

## Data model

`packages/data/prisma/schema.prisma` (migration `20260619080811_add_employee_attribution`, additive):

- **`Employee`** — per-`PartnerAccount` roster row. `accountId` → `PartnerAccount.userId` (= the site
  owner's `User.id`), `name`, `active`, `onDelete: Cascade`. Workers rotate across a partner's sites,
  so the roster is account-scoped, not site-scoped (most partners are single-site anyway).
- **`TillClose`** — a shift-close reconciliation snapshot: `siteId`, `employeeId`, `closedAt` (default
  now), `totalAmount`, `txnCount`. One row per "close my till".
- Nullable **`employeeId` FK** on `Reservation` and `RentalBooking` (`onDelete: SetNull` — deleting an
  employee nulls attribution but keeps the transactions). Threaded through the create helpers
  `reserveWithConflictGuard` / `createRentalBookingsWithGuard` (`packages/data/src/reservations.ts`)
  the same way `isComp` is — spreads to `prisma.create`, no logic change.

## Roster CRUD — `/account/staff`

`apps/partner/app/account/staff/` (mirrors `app/security/`): `getEmployees`, `createEmployee`,
`renameEmployee`, `setEmployeeActive`, `deleteEmployee`. **Session/account-scoped** — every query
filtered by `accountId: session.user.id`; mutations use compound-`where` `updateMany`/`deleteMany`
(no unique `(id, accountId)` index, and it stops cross-account writes). Data-returning, so these sit
on the coverage-contract `UNGATED_ALLOWLIST`, not `gated-actions.ts`.

## Attribution — the current-worker chip

The roster is read **server-side** in `manage/page.tsx` (the manage page is token-gated/session-less,
so a session action can't read it) and passed down to `ManageView` → `ManageToolbar`. The chip
(`WorkerChip` in `ManageToolbar.tsx`) remembers the choice per-device-per-site in
`localStorage('sunbnb-manage-worker-${site.id}')`, re-validates it against the live roster, and is
**hidden when the roster is empty**. The selected `employeeId` flows into every on-site create action
(`reserveItem`, `holdBed`, `compBed`, `blockBed`, `createWalkInRental`, `convertHoldToWalkIn`) as an
optional trailing arg, also threaded through `BedDetail`, `CreateRentalModal`, and the multiselect bulk
handlers.

Each action validates the id with **`resolveEmployeeId(employeeId, accountUserId)`**
(`manage/actions.ts`): returns the id only when the employee exists and `accountId === ownership.userId`,
else `null` — a stale or cross-account id is **silently dropped**, never blocks or mis-attributes the
booking. Cash walk-ins additionally record `paymentAmount` (from DB prices via `computeWalkInAmount`,
paid sites only) so the till has money — see [[flow:walk-in]].

## Per-worker till — manage page

Aggregation in `packages/data/src/till.ts`:
- **`getOpenTill(siteId, employeeId)`** → `{ total, count }` — cash the worker has taken at this site
  since the later of their last `TillClose.closedAt` and start-of-today (cash walk-ins
  `paid-in-cash`/`walked-in` + cash rentals `paid-in-cash`; comps/blocks/holds excluded).
- **`getTillByEmployee(siteId, from, to)`** → per-roster `{ employeeId, name, active, total, count }[]`,
  zero-filled and name-sorted (for the manager breakdown).

UI: a `💶 Till` button beside the chip (shown once a worker is set) opens **`TillSheet.tsx`** —
the open till € + sales count + a two-step **Close till**. Two token-or-session manage actions back it:
**`getTillStatus`** (validates the worker, returns `getOpenTill`) and **`closeTill`** (snapshots the
open total into a `TillClose` row; an empty till is a **no-op** — no row, harmless double-close). Both
are in the `gated-actions.ts` registry.

## Manager breakdown — accounting page

**`getStaffTill(siteId, year, month)`** (`accounting/actions.ts`, session + site-owner) calls
`getTillByEmployee` with whole-month bounds. `accounting/view.tsx` renders a "Staff cash till" card
(workers with cash, sorted by total desc, month total) after the month summary — hidden when the
roster is empty. Scoped to the **selected month** (reuses the page's month navigator), not a single
day. Read-only retrospective (Sunbnb never resets). Sits beside the track-007 revenue/occupancy cards.

## Testing & the mock-aliasing trap

`@repo/data/till` imports prisma via `../index` (real), so partner **unit** tests would otherwise hit
a real DB on the gate-pass path. It is aliased to **`__mocks__/@repo/data/till.ts`**
(`getOpenTill`/`getTillByEmployee` stubs) in `vitest.config.ts`, and registered in the
**`mock-contract`** SUBMODULE_SPECS (mock must stay a superset of the real exports). New manage actions
(`getTillStatus`/`closeTill`) are in `gated-actions.ts` → the auth-matrix; `getStaffTill` + the staff
CRUD are coverage-contract allowlisted. Real aggregation is integration-tested in
`packages/data/src/till.integration.test.ts`; partner attribution + till in
`app/sites/[id]/manage/actions.integration.test.ts`.

## Pointers

- Track + design history: `.claude/tracks/008-employee-model.md`.
- Partner surface map: `apps/partner/CLAUDE.md` (route `/account/staff`; manage/accounting actions).
- Sibling tracks: 006 (floor states) and 007 (analytics — the `@repo/data/analytics` pattern `till.ts`
  mirrors).
