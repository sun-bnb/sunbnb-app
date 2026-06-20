---
id: 008-employee-model
title: Employee Model — floor-staff attribution & per-worker till
status: active
created: 2026-06-19
updated: 2026-06-19
worktree: null
---

## Goal

Bring **all of Alonso's employee features** to Sunbnb's partner manage page — staff attribution +
a per-worker daily cash till with a "close my till" shift-close — woven in **organically and
minimally** (no per-transaction input, no bed-dialog clutter). The Alonso "Group A" sibling of
[[track:006-alonso-staff-ui]] (floor states) and [[track:007-operator-analytics]] (analytics).

**Why:** the manage page has **zero floor-staff identity** today (every on-site transaction is
stamped with the site *owner's* `userId`), so a multi-worker venue can't tell who rang up what and
has no daily per-worker cash reconciliation. Alonso proves the operational value.

**Leapfrog over Alonso:** Alonso's "employee" is a free-text name with a single per-device default
that wipes at day-reset (verified in the bundle — drifts to one static name, no cross-day reports).
Sunbnb does a real **roster + persisted attribution** on its server-authoritative, date-indexed
substrate → durable per-worker reporting Alonso can't do.

**Decisions (with user, 2026-06-19):** roster = a **per-PartnerAccount `Employee` model** (workers
rotate across a partner's sites; most partners are single-site anyway); **full close** (per-worker
till + reconciliation snapshot + manager day-breakdown). **Baked-in (from "avoid input/clutter"):**
attribution is **automatic** — set the *current worker* once via a toolbar chip (remembered
per-device like dark mode), every on-site action auto-stamps it; **no per-transaction field, no PIN**.
Orders **out of scope** (consumer-created; Alonso has no F&B). Authorization (`accessKey`/
`SecurityToken`) unchanged — attribution is orthogonal.

Full design: `/Users/vhalme/.claude/plans/fuzzy-jumping-fountain.md` (approved 2026-06-19).

## Resume here

- **Phase 1 DONE (2026-06-19, committed `dfc0512`).** Migration `20260619080811_add_employee_attribution`
  (additive: `Employee` per-account + `TillClose` + nullable `employeeId` FK on
  Reservation/RentalBooking) applied to local + `sunbnb_test`. `employeeId` threaded through
  `ReservationCreateData`/`RentalBookingInput` + both create helpers. `packages/data/src/till.ts`
  (`getOpenTill`/`getTillByEmployee`) + 3 till integration tests. `./till` export + partner mock
  `employee`/`tillClose` delegates. **`migrate:test` (Neon TEST DB) owed before any `main` push.**
- **Phase 2 DONE (2026-06-19, UNCOMMITTED — awaiting "commit it").** Roster CRUD + current-worker chip
  + attribution all built & green. **Slice 1 (partner-dev):** `apps/partner/app/account/staff/`
  (`actions.ts` getEmployees/createEmployee/renameEmployee/setEmployeeActive/deleteEmployee — session/
  account-scoped via `accountId: session.user.id`, `updateMany`/`deleteMany` compound-where; `page.tsx`
  + `view.tsx` mirroring `security/`); Staff nav link in `header.tsx`; `Staff`/`Header.staff` i18n in
  en/es/fi; 5 coverage-contract `UNGATED_ALLOWLIST` entries; mock gains `employee.updateMany`; 28 unit
  tests. **Slice 2 (me):** `employeeId` threaded into the manage create actions (`reserveItem`/`holdBed`/
  `compBed`/`blockBed`/`createWalkInRental` **+ `convertHoldToWalkIn`**) — trailing optional param,
  validated via new `resolveEmployeeId(id, accountUserId)` (drops cross-account/stale → null, never
  blocks the booking). **Walk-in cash € recorded** on `reserveItem` AND `convertHoldToWalkIn` (reuse
  `computeWalkInAmount`, paid sites only) so the till has money. Current-worker chip: server-fetched
  active roster passed from `manage/page.tsx` → `ManageView` → `ManageToolbar` `WorkerChip`
  (localStorage `sunbnb-manage-worker-${site.id}`, re-validated vs roster; hidden when roster empty);
  threaded into `BedDetail` + `CreateRentalModal` + the bulk handlers; `setWorker`/`noWorker` i18n.
  No new gated-actions (param is orthogonal to the gate). Verify: partner **1455 unit** (spine green) +
  **33 manage integration** (4 new attribution: stamp / cross-account drop / free-site / rental) +
  tsc/lint clean. `computeWalkInAmount` kept LOCAL to manage/actions.ts (both callers live there — no
  `@repo/data` promote needed).
- **Phase 3 DONE (2026-06-19, UNCOMMITTED — awaiting "commit it").** Per-worker till + "close my till"
  on the manage page. Two new token-or-session manage actions: `getTillStatus(siteId, employeeId,
  accessKey?)` (validates the worker via `resolveEmployeeId`, returns `getOpenTill` `{ total, count }`)
  and `closeTill(...)` (snapshots the open total into a `TillClose` row; empty till = no-op
  `closed:false`, no snapshot). Both registered in `gated-actions.ts` (auth-matrix +14 → 474).
  **Mock-aliasing trap handled:** `@repo/data/till` uses real prisma via `../index`, so unit tests need
  it stubbed — added `__mocks__/@repo/data/till.ts` (`getOpenTill`/`getTillByEmployee`), the
  `@repo/data/till` alias in `vitest.config.ts`, and a `till` entry in `mock-contract` SUBMODULE_SPECS
  (mock-contract +1 → 13). **UI:** `TillSheet.tsx` (bottom-sheet, mirrors `CollectPaymentModal`) shows
  open till € + sales count + two-step **Close till**; `ManageToolbar` gains a `💶 Till` button next to
  the worker chip (shown once a worker is set) → `onOpenTill` → `view.tsx` `showTill` → `TillSheet`
  (fetches `getTillStatus` on open, `closeTill` then `router.refresh()`). `Till` i18n namespace + the
  `SiteManage.till` key in en/es/fi. Verify: partner **1470 unit** (spine green) + **37 manage
  integration** (4 new till: open reflects walk-in, close snapshots+resets, empty no-op, unknown worker
  rejected); tsc/lint clean.
- **Phase 4 DONE (2026-06-19, UNCOMMITTED — awaiting "commit it"). ALL FOUR PHASES COMPLETE.**
  Manager per-employee cash breakdown on the **accounting** page. New session+site-owner action
  `getStaffTill(siteId, year, month)` (`accounting/actions.ts`) → `getTillByEmployee` with whole-month
  bounds → per-worker `{ employeeId, name, active, total, count }[]`; added to coverage-contract
  `UNGATED_ALLOWLIST` (data-returning, like `getRevenueTrend`). **Deviation from plan:** scoped to the
  selected **month** (reuses the page's existing month selector) rather than a single day — cleaner on a
  month-axis page, no redundant day-picker; revisit if daily granularity is wanted. `accounting/view.tsx`
  renders a "Staff cash till" card after the summary cards (workers with cash, sorted by total desc,
  month total) — **hidden when the roster is empty** so single-operator venues see nothing. `SiteAccounting`
  i18n (staffTill/staffTillHint/noStaffCash/staffSales/inactiveStaff) in en/es/fi. 3 unit tests
  (auth/ownership reject, month-bounds delegation). partner **1473 unit** + tsc/lint clean. `TillClose`
  history surfacing deferred (the cash breakdown is the core value).
- **Next action:** **NONE — DONE & LIVE on test+prod (deployed 2026-06-20).** All 4 phases committed
  (`dfc0512`…`2005640`), docs synced, the `20260619080811_add_employee_attribution` migration applied
  to TEST + PROD Neon DBs, and `main`→test→production deployed (all at `e7952fd`). Full Alonso "Group A"
  closed. Track moved to **Done/archived** in the registry.
- **Blocked by:** nothing.

## Roadmap

- ✅ **Phase 1 — schema + `@repo/data` foundation. DONE 2026-06-19.** Migration applied (local +
  `sunbnb_test`); `employeeId` threaded through both create helpers; `till.ts` (`getOpenTill`/
  `getTillByEmployee`) + 3 integration tests; `./till` export; partner mock delegates. data 192/102,
  partner 182 green. Walk-in cash-amount recording moved to Phase 2. `migrate:test` owed before push.
- ✅ **Phase 2 — roster CRUD + current-worker chip + attribution. DONE 2026-06-19 (uncommitted).**
  `account/staff/` roster (mirror `security/`, account-scoped); `WorkerChip` in `ManageToolbar`
  (localStorage, roster-validated, hidden when empty); `employeeId` threaded into all manage create
  actions + `convertHoldToWalkIn` via `resolveEmployeeId` (cross-account drop, never blocks); walk-in
  cash € recorded on `reserveItem` + `convertHoldToWalkIn`. partner 1455 unit + 33 manage integration,
  tsc/lint clean. No new gated-actions (param orthogonal to the gate); staff actions allowlisted.
- ✅ **Phase 3 — per-worker till + "close my till" (manage). DONE 2026-06-19 (uncommitted).**
  `getTillStatus` + `closeTill` (token-or-session, gated-actions registered); `TillSheet` + `💶 Till`
  toolbar button (shown when a worker is set); `TillClose` snapshot, empty-till no-op; open till resets
  after close. `@repo/data/till` mock + alias + mock-contract entry (real-prisma submodule). partner
  1470 unit + 37 manage integration green.
- ✅ **Phase 4 — manager per-employee breakdown (accounting). DONE 2026-06-19 (uncommitted).**
  `getStaffTill(siteId, year, month)` → `getTillByEmployee` (month bounds); "Staff cash till" card on
  `accounting/view.tsx` (per-worker cash, month total, hidden when no roster). Scoped to the selected
  **month** (not a single day) to reuse the page's month selector. coverage-contract allowlisted; 3 unit
  tests. partner 1473 unit green. `TillClose` history surfacing deferred.

## Open decisions

- **Walk-in cash amount on `reserveItem`.** Recording `paymentAmount` on cash walk-ins (so the till
  has €) also makes cash revenue visible where it's invisible today (no invoice). Confirm this is
  desired as part of Phase 1 (it is needed for a meaningful till).
- **Attribute the QR collection separately?** A walk-in already carries `employeeId` from creation;
  whether to also stamp who *collected* (current worker at collect time, possibly different) is
  optional — default: inherit creation attribution.

## Links

- Plan: `/Users/vhalme/.claude/plans/fuzzy-jumping-fountain.md`.
- [[track:005-alonso-beach-model]] — design source; `.claude/alonso/model/{employees-and-access,accounting-and-dayclose}.md` (per-employee shift-close `Xie.m`, `rentalHistory`).
- [[track:006-alonso-staff-ui]] · [[track:007-operator-analytics]] — siblings; analytics helper pattern (`@repo/data/analytics`) is the model for `till.ts`.
- Rules: `.claude/rules/{architecture,data-access,migrations}.md`; UI: `/ui partner`.
