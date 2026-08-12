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
  - apps/partner/app/sites/[id]/manage/DailySummaryView.tsx
  - apps/partner/app/sites/[id]/manage/DayCloseView.tsx
  - apps/partner/app/sites/[id]/accounting/actions.ts#getStaffTill
  - .claude/tracks/008-employee-model.md
  - .claude/tracks/016-day-anchored-till.md
related:
  - flow:walk-in
  - entity:reservation
  - entity:settlement
last_verified: 2026-07-23
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
  now), `totalAmount`, `txnCount`, plus `carryOverAmount`/`carryOverCount` (nullable, migration
  `20260723140622_add_till_close_carry_over`, track 016) — the portion of the snapshot that predated
  the close's venue-local day. Closes are **irreversible partitions** (no reopen — same semantics as
  Alonso's `shiftClosedAt`); the next cash entry starts a fresh window.
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

## Per-worker till — day-anchored two-bucket model (track 016)

The till is **day-anchored** (track 016, driven by pilot-operator feedback: an Alonso-trained
operator expects a strictly per-day till, and the old since-last-close window silently rolled
cash across days). Aggregation in `packages/data/src/till.ts`; every open-till function takes a
**required venue-local `dayStart`** (computed by the caller via `siteDayBounds` — the till module
is timezone-agnostic). Per employee, with `floor = max(lastClose, dayStart)`:

- **today** bucket — non-voided `TillEntry` rows with `settledAt > floor`.
- **carryOver** bucket — unclosed rows in `(lastClose, dayStart]` (boundary entry at exactly
  `dayStart` is carry-over), labeled with `oldestAt`. Empty once the worker has closed today.
- **`total = today + carryOver`** — the *sweepable* balance. A close always sweeps both
  ("sweep-together" decision: cash is never orphaned, no partial close); **no auto-close at
  midnight** (a `TillClose` is a human attestation — forgotten cash surfaces as carry-over
  instead).

Key exports: **`getOpenTill(siteId, employeeId, dayStart)`** → `OpenTill { total, count, today,
carryOver }`; **`closeEmployeeTill(siteId, employeeId, dayStart)`** — the *single* snapshot
writer (records `carryOverAmount`/`carryOverCount`; zero-balance = no-op); **`closeAllOpenTills`**
(built on it; returns `carryOverClosed`); `getOpenTillsByEmployee` / `getOpenTillItemsByEmployee`
(bucketed rosters; items flagged `carryOver: boolean`). Civil-day reports —
**`getTillByEmployee(siteId, from, to)`** → `EmployeeCashTotal[]` and `getEmployeeShiftItems` —
sum by `settledAt` window and are **close-independent**: the day's accumulation never changes when
tills close. This is the load-bearing split: *drawer questions* (what would this worker hand in?)
read the buckets; *day questions* (what did we take today?) read the civil-day reports.

UI: a `💶 Till` button beside the chip (shown once a worker is set) opens **`TillSheet.tsx`** —
leads with **"Today €X"**, shows an amber carry-over banner ("Uncounted cash from {date} —
included when you close") when applicable, and a two-step **Close till** over the sweepable total
(close button gates on `total === 0`, so €0-today + carry-over is still closeable). Backed by
**`getTillStatus`** / **`closeTill`** (routes through `closeEmployeeTill`); both in the
`gated-actions.ts` registry.

## Admin daily summary & day close — `/manage/summary`, `/manage/close`

Both admin-token-gated (`verifySiteAdmin`). **`DailySummaryView.tsx`** (summary): the open-tills
tab **leads with the daily accumulation** (`getTillDayReport` for today — provably constant
across closes) and reconciles it with two secondary lines — "Still uncounted" (sum of `today`
buckets) and "Handed in today" (day total − uncounted) — plus an amber carried-over line for
pre-today cash; per-worker cards below are drawer views (today lead + carry-over chip + itemized
rows with carry-over dots) with per-worker close. The day-report tab (`getDayShiftItems`,
cash+card) is unchanged history. **`DayCloseView.tsx`** (`closeDay` → `closeAllOpenTills`):
anchored to today's date, shows the day totals + "€Y of that is carried over from previous days",
success copy "€X counted (€Y from previous days)". Cash-up only — never touches floor state.

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

## Refunds vs closed hand-ins (Option B, 2026-08-12 — track 018)

`voidedAt` means "this settlement never counted" and is only valid while the cash is
still in the drawer (open window or unclosed carry-over). Once an entry was swept by a
`TillClose`, a refund posts a **negative counter-entry** instead (settledAt = now,
employeeId = the refunder's chip, linked to the same reservation): yesterday's civil-day
reports and close snapshots stay frozen, today's drawer shows the payout, and the
counter-entry renders as a negative line in shift itemizations. Consequences: entry
amounts can be NEGATIVE (sums flow through all till math); a worker whose only event
today is a refund closes at a negative hand-in. Null-employee entries are never swept
by a close (TillClose is per-employee) ⇒ always voidable. Writer: the reservation
machine's `tillVoid`/`tillPartition` executors (`reservation-machine-apply.ts`).

