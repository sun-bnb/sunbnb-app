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
- **Next action:** **Phase 3** — per-worker till + "close my till" on the manage page. From the chip,
  a till panel (sheet) showing `getOpenTill(siteId, currentWorkerId)` (already in `@repo/data/till`) —
  cash this shift — and a **Close till** action. New gated manage action `closeTill` (token-or-session,
  add to `gated-actions.ts` registry) snapshots the open total into a `TillClose` row (worker, site,
  total, count, closedAt); open till then reads zero. Prime `/ui partner`.
- **Context needed:** the chip's `currentWorkerId` lives in `ManageView` (view.tsx, localStorage
  `sunbnb-manage-worker-${site.id}`) — the till panel hangs off the same chip. `getOpenTill` returns
  `{ total, count }` since the worker's last `TillClose.closedAt` (today-scoped). `closeTill` is a new
  manage action → MUST be added to `app/test/gated-actions.ts` (token-or-session) or coverage-contract
  fails. Manage page is token-gated/session-less; the till read can be a new token-gated action OR
  server-fetched in `page.tsx` like the roster.
- **Blocked by:** nothing. `migrate:test` still owed before the eventual `main` push.

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
- ☐ **Phase 3 — per-worker till + "close my till" (manage).** Till panel (`getOpenTill`) + `closeTill`
  writing a `TillClose` snapshot; open till resets after close.
- ☐ **Phase 4 — manager per-employee day-breakdown (accounting).** Staff-till section + `TillClose`
  history (mirror the track-007 trend card).

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
