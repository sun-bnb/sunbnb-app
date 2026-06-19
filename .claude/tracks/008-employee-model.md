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

- **Phase 1 DONE (2026-06-19, uncommitted).** Migration `20260619080811_add_employee_attribution`
  (additive: `Employee` per-account + `TillClose` + nullable `employeeId` FK on
  Reservation/RentalBooking) applied to local + `sunbnb_test`. `employeeId` threaded through
  `ReservationCreateData`/`RentalBookingInput` + both create helpers. New
  `packages/data/src/till.ts` (`getOpenTill` = cash walk-ins + cash rentals attributed to a worker
  since their last close, today-scoped; `getTillByEmployee` = per-roster day-breakdown) — comps/
  blocks/holds excluded. `./till` export wired; partner `PrismaCient` mock gains `employee`/`tillClose`
  delegates. 3 till integration tests (attribution persists, close resets, breakdown). data 192 unit /
  102 integration, partner 182 + typecheck/lint clean. **`migrate:test` (Neon TEST DB) owed before any
  `main` push** (pre-push hook enforces). **Deferred to Phase 2:** promote `computeWalkInAmount` to
  `@repo/data` + have `reserveItem` record the walk-in cash amount (lands with the `employeeId`
  threading into the manage actions).
- **Next action:** **Phase 2** — `account/staff/` roster CRUD (mirror `apps/partner/app/security/`);
  current-worker chip in `ManageToolbar` (localStorage `sunbnb-manage-worker-${site.id}`); add an
  `employeeId` param to the manage create actions (reserveItem/holdBed/compBed/blockBed/
  createWalkInRental) that validates `employee.accountId === site.userId` then stamps it; record the
  walk-in cash amount in `reserveItem`. Register new gates in `gated-actions.ts`. Prime `/ui partner`.
- **Context needed:** schema is greenfield for this (no Employee model; `SecurityToken` carries no
  holder; transactions carry only `userId` = owner). Create helpers: `ReservationCreateData` /
  `RentalBookingInput` in `packages/data/src/reservations.ts` (add optional `employeeId`, spreads to
  `prisma.create` like `isComp` did). `computeWalkInAmount` currently lives in
  `apps/partner/app/sites/[id]/manage/actions.ts` (from the QR-collect flow). Migration doctrine:
  `.claude/rules/migrations.md` (additive/expand-safe; `migrate:local` foreground only).
- **Blocked by:** nothing. Architecture/data pass applies (schema + cross-app).

## Roadmap

- ✅ **Phase 1 — schema + `@repo/data` foundation. DONE 2026-06-19.** Migration applied (local +
  `sunbnb_test`); `employeeId` threaded through both create helpers; `till.ts` (`getOpenTill`/
  `getTillByEmployee`) + 3 integration tests; `./till` export; partner mock delegates. data 192/102,
  partner 182 green. Walk-in cash-amount recording moved to Phase 2. `migrate:test` owed before push.
- ☐ **Phase 2 — roster CRUD + current-worker chip + attribution.** `account/staff/` roster (mirror
  `security/`); toolbar chip (localStorage); thread `employeeId` into the manage actions with
  cross-account validation; gated-actions registry.
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
