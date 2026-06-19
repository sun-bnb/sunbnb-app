---
id: 007-operator-analytics
title: Operator Analytics & Exports
status: active
created: 2026-06-18
updated: 2026-06-18
worktree: null
---

## Goal

Surface the **operator's daily pulse** on the partner app — the low-effort half of the Alonso
gap ([[track:006-alonso-staff-ui]] "Group B"). Three operator-facing wins, all on **existing**
partner surfaces (dashboard + accounting page), backed by **shared `@repo/data` aggregation
helpers**:

- **B1 · Comp & occupancy visibility.** Occupancy % over time + "we gave away N comped beds."
  Today the accounting page is **invoice-driven only** (`getPaidItemsByMonth` sums
  `invoice.totalAmount`), so comps (no invoice) and occupancy (capacity-based, not revenue) are
  **invisible** — exactly the blind spot the just-shipped comps created.
- **B2 · Rolling-window revenue lens.** A last-7/30/365-day revenue+volume trend and "best day,"
  alongside the existing **calendar-month** accounting. Rolling = *operational pulse*; monthly =
  *accounting truth* — both lenses, not a mental conversion.
- **B3 · Plain CSV/TXT figures export.** A "just give me the numbers" dump for a spreadsheet /
  accountant. Sunbnb leans on PDFs today.

**Why it matters.** These are the irreducible figures a real chiringuito actually looks at, and
they're **cheap** (mostly re-slicing data the accounting/dashboard pages already pull) — the best
next bite after 006 closed the floor-state half. **Not** the heavy Alonso "Group A" (per-staff
daily cash close) — that's a separate, higher-effort track gated on cash-heavy multi-worker venues.

**Audience = the venue operator → partner app only.** Per-site scoped. Not admin (that's
cross-partner settlement oversight), not the consumer app.

## Resume here

- **Phase 1 DONE (2026-06-18, uncommitted).** `packages/data/src/analytics.ts` shipped with all four
  helpers exactly as roughed out; `./analytics` export added to `package.json` (both blocks). Tests
  green: `analytics.test.ts` (7 unit — the pure pair) + `analytics.integration.test.ts` (2 against
  `sunbnb_test` — site-scoped/PARTNER-only revenue grouping; occupancy vs capacity excluding
  no-show/departed, comps counted). Data suite 190 unit, typecheck (`tsc --rootDir .` — only
  pre-existing `payment.test.ts` `product` errors remain) + lint clean. No app mock added (no
  unit-tested surface imports it yet — revisit at Phase 2).
- **Phase 2 DONE (2026-06-18, uncommitted).** Rolling lens landed on the **per-site accounting page**
  (decision below — the dashboard is account-wide, so B2 went where the per-site helper + B1/B3 live).
  `getRevenueTrend(siteId, days)` action in `accounting/actions.ts` (session + ownership; clamps to
  7/30/365; composes `getRevenueByDay`+`summarizeRevenue`). `accounting/view.tsx` gained a window
  selector + total/sales/best-day cards + a daily revenue bar trend. Wired the partner
  `@repo/data/analytics` mock + alias + `mock-contract` spec + `coverage-contract` entry; 4 new action
  tests. i18n (`recentTrend`/`sales`/`bestDay`/`noRevenueYet`, ES/FI machine — copy review owed).
  Full partner suite 1420, typecheck + lint clean.
- **Next action:** **Phase 3 (B1)** — comp & occupancy on the same accounting view. Add a
  `getOccupancyTrend(siteId, days)` action (same auth wrapper) over `getOccupancyByDay`; render an
  occupancy-% + comp-count block. The `analytics` mock already stubs `getOccupancyByDay`. Then
  **Phase 4 (B3)** — a "Download figures (CSV)" button using `toFiguresCsv` over the trend rows.
- **Context needed:**
  - Existing accounting actions to generalize: `apps/partner/app/sites/[id]/accounting/actions.ts`
    — `getPaidItemsByMonth(siteId, year, month)` (orders+reservations with a PARTNER invoice in a
    calendar month) and `getInvoicesByMonth(accountId, year, month)`. Both do **auth inline then
    query**; the new design keeps that split (auth in the partner action, pure aggregation in
    `@repo/data`, mirroring `payment.ts`/`settlement.ts`).
  - Occupancy semantics to reuse: the blocking-overlap query in
    `apps/user/service/availabilityService.ts` / `reserveWithConflictGuard`
    (`status ∈ BLOCKING_STATUSES`, `operationalStatus ∉ [no-show, departed]`, `from ≤ dayEnd ∧ to ≥
    dayStart`). Capacity = count of `InventoryItem` with `status:'active'` for the site.
  - Comp marker: `Reservation.isComp` (shipped in 006).
  - Architecture/data rules apply (schema-free — read-only aggregation; `.claude/rules/data-access.md`).
- **Blocked by:** nothing. No schema change expected (read-only aggregation over existing tables).

## Helpers — rough-out (Phase 1 deliverable)

New module **`packages/data/src/analytics.ts`** — site-scoped, read-only aggregation. Pure helpers
are unit-tested (no DB); DB helpers integration-tested against `sunbnb_test`. Partner actions wrap
them with `auth()` + site-ownership (as the accounting actions already do).

```ts
export interface DailyRevenue   { date: string /* YYYY-MM-DD */; revenue: number; count: number }
export interface RevenueSummary { totalRevenue: number; totalCount: number; bestDay: DailyRevenue | null }
export interface DailyOccupancy { date: string; capacity: number; occupied: number; comps: number; occupancyPct: number }

// ── Pure (no DB → unit-tested) ───────────────────────────────────────────────
/** Totals + highest-revenue day over a windowed set. Powers B2's headline + "best day". */
export function summarizeRevenue(rows: DailyRevenue[]): RevenueSummary

/** Fixed-column figures dump (date, count, revenue) → CSV (and a TXT variant). Powers B3.
 *  Serializes EXACTLY the rows it's given — no hidden full-history vs window mismatch
 *  (the bug Alonso's TXT export had: windowed on screen, full history in the file). */
export function toFiguresCsv(rows: DailyRevenue[]): string

// ── DB-dependent (→ integration-tested) ──────────────────────────────────────
/** Per-day revenue+volume for a site over [from, to]. Generalizes getPaidItemsByMonth from
 *  calendar-month → arbitrary range, grouped by invoicedAt date. Revenue = PARTNER invoices on
 *  the site's reservations + orders (join via reservation/order siteId, issuerType:'PARTNER').
 *  Powers B2 (rolling lens) and feeds B3 (export). */
export async function getRevenueByDay(siteId: string, from: Date, to: Date): Promise<DailyRevenue[]>

/** Per-day occupancy for a site over [from, to]. NOT invoice-driven (the new data work):
 *  capacity = active InventoryItem count; occupied = distinct blocking reservations overlapping
 *  the day (BLOCKING_STATUSES, op-status ∉ [no-show, departed]); comps = those with isComp.
 *  occupancyPct = occupied / capacity. Powers B1. */
export async function getOccupancyByDay(siteId: string, from: Date, to: Date): Promise<DailyOccupancy[]>
```

Notes / decisions baked in:
- **Auth stays in the app layer.** `@repo/data` helpers take a `siteId` and trust the caller — the
  partner action does `auth()` + `site.userId === session.user.id` first (same as the accounting
  actions). Keeps the helpers pure/testable.
- **`getRevenueByDay` is the heavier query** (revenue is site-scoped only via the
  reservation/order → invoice join, since `Invoice` is `accountId`-scoped not `siteId`-scoped).
  Mirror `getPaidItemsByMonth`'s join; group by `invoicedAt` truncated to the day.
- **No schema change.** All read-only over `Invoice`/`Reservation`/`InventoryItem`. If a perf
  problem shows up on large ranges, consider a daily-rollup later — not in v1.
- **Export contract:** `toFiguresCsv` serializes its argument verbatim — callers pass the SAME
  windowed rows shown on screen.

## Roadmap

- ✅ **Phase 1 — `@repo/data/analytics` helpers + tests. DONE 2026-06-18.** `analytics.ts` with
  `summarizeRevenue`/`toFiguresCsv` (pure) + `getRevenueByDay`/`getOccupancyByDay` (DB); `./analytics`
  export wired; 7 unit + 2 integration tests green; typecheck + lint clean. No app mock yet (no
  unit-tested surface imports it). Uncommitted.
- ✅ **Phase 2 — B2 rolling revenue lens. DONE 2026-06-18** (on the **accounting page**, not the
  dashboard — the dashboard is account-wide while the helper is per-site; see decision below).
  `getRevenueTrend` action + window selector + total/sales/best-day + daily bar trend on
  `accounting/view.tsx`; partner `analytics` mock/alias/contract wired; 4 action tests; 1420 green.
- ☐ **Phase 3 — B1 comp & occupancy (accounting page).** On `apps/partner/app/sites/[id]/accounting`,
  add an occupancy % + comp-count block fed by `getOccupancyByDay` (the new non-invoice query).
  Surfaces the "gave away N beds / ran at X% full" the invoice-driven page can't show.
- ☐ **Phase 4 — B3 figures export.** A "Download figures (CSV)" button on the accounting page using
  `toFiguresCsv` over the period's `getRevenueByDay` rows (client-download, no server round-trip,
  mirroring the receipt-PDF pattern). Optional TXT variant.

Sequencing: Phase 1 is the foundation; 2/3/4 are independent vertical slices on top and can land in
any order (or be cherry-picked). Each is small.

## Open decisions

- **Rolling vs calendar home — RESOLVED (2026-06-18, with user): the per-site accounting page.**
  The dashboard is account-wide (`accountId`-scoped) while the Phase-1 helpers are per-site, and
  B1/B3 are per-site too — so the whole B-set co-locates on `/sites/[id]/accounting`, calendar-month
  truth + rolling pulse side by side. (An account-wide dashboard lens would need a separate
  `getAccountRevenueByDay` helper — not pursued.)
- **Occupancy denominator.** Capacity = active `InventoryItem` count *today*, or capacity *as of
  each historical day*? Inventory rarely changes; v1 uses current active count and notes the
  caveat. Revisit if operators add/remove beds mid-season.
- **Mock-contract churn.** Decide per surface whether `analytics` needs an app mock (server
  components don't; a client component calling an action might) — resolve at Phase 2 wiring.

## Links

- [[track:006-alonso-staff-ui]] — parent; this is its "Group B" backlog item (per-staff cash close
  = "Group A" = a separate future track). Gap analysis: `.claude/alonso/model/synthesis-sunbnb.md`
  (lessons 7 + 8) and [[track:005-alonso-beach-model]]'s `reporting.md` / `accounting-and-dayclose.md`.
- [[track:002-table-reservations]] — sibling "leisure-venue OS" ambition; operator analytics is the
  same vision's reporting half.
- Target surfaces: `apps/partner/app/dashboard`, `apps/partner/app/sites/[id]/accounting/`.
- Rules: `.claude/rules/data-access.md` (read-only aggregation in `@repo/data`),
  `.claude/rules/architecture.md` (new `@repo/data` export = a shared-contract pass),
  `.claude/rules/ui.md` + `apps/partner/UI.md` (prime `/ui partner` for the surfaces).
