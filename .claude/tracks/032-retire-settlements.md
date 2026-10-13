---
id: 032-retire-settlements
title: Retire the legacy admin settlement feature (expand/contract)
status: active
created: 2026-10-13
updated: 2026-10-13
worktree: null
---

## Goal

Remove the admin payout-settlement feature. It modelled the platform collecting consumer money and
paying partners out (March 2026); since direct charges (Mollie for Platforms, Stripe Connect, Viva)
the partner's own provider account is paid and the commission is taken at charge time, so there is
nothing for the platform to settle. It had never been used — production had 0 `Settlement` rows and
0 invoices with `settlement_batch_id` (checked 2026-10-13) — and it had silently fallen behind every
later product (rentals, deposits, tabs, cash receipts, credit notes, Stripe, Viva). Partner money
reporting is the partner accounting page + invoices, which is what the merchant agreement promises.

## Resume here

- **Next action:** Step 2 (contract) — only after step 1 is on `test` (promoted), so no deployed
  code references the table: a migration dropping `"Settlement"`, `"Invoice".settlement_batch_id`
  and the `SettlementStatus` enum (check for an `assistant.*` view pinning the column first —
  `.claude/rules/migrations.md`); in the same change remove the legacy cleanup in
  `apps/admin/app/users/actions.ts#deleteUser` (+ its tests and the `settlement` entry in
  `apps/admin/__mocks__/@repo/data/PrismaCient.ts`), the `// LEGACY` comment in `schema.prisma`, and
  the relation fields on `PartnerAccount` / `Site`. Apply to the test DB at promote time (contract).
- **Then:** delete `.claude/wiki/entities/settlement.md` and `flows/settlement-cycle.md` (grace ends
  2026-11-12) and their "Retired" index line; close this track.
- **Keep:** `Invoice.settlementId` — a different field (the provider's own payout settlement id).
- **Blocked by:** step 1 being promoted to test (founder's call).

## Roadmap

- ✅ **Step 1 (expand side, 2026-10-13)** — removed `apps/admin/app/settlements/` (page, view,
  actions, 19 tests), `@repo/data/settlement` (+ integration test, package export), the admin
  `settlement` mock + vitest alias, nav entry and `/settlements` redirects (landing → `/partners`),
  the unused `_count.settlements` on the partners page; docs, agent, playbook, `/db` command and
  wiki pages retired. Schema untouched apart from a `// LEGACY` comment.
- ☐ **Step 2 (contract)** — drop the table, column, enum and the `deleteUser` cleanup.

## Log

- **2026-10-13** — Found by track 031 P5 verification (settlement selection ignored rental,
  deposit and tab invoices). Founder confirmed the feature is legacy; retired instead of fixed.
  Admin 225 tests and `@repo/data` 1,206 unit tests green; both typechecks clean (admin needed its
  generated `.next/types` refreshed after the route was deleted).

## Links

- [[track:031-context-system-v2]] — where the finding came from
- [[subsystem:payments]] — the direct-charge model that made settlements obsolete
