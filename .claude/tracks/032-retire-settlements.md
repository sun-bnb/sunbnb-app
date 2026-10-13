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

- **Next action:** after 2026-11-12, delete `.claude/wiki/entities/settlement.md` and
  `.claude/wiki/flows/settlement-cycle.md` and their line under index "Retired", then close this
  track. Nothing else remains: step 1 and step 2 are on production.
- **Keep:** `Invoice.settlementId` — a different field (the provider's own payout settlement id).
- **Blocked by:** the wiki grace period only.

## Roadmap

- ✅ **Step 1 (expand side, 2026-10-13)** — removed `apps/admin/app/settlements/` (page, view,
  actions, 19 tests), `@repo/data/settlement` (+ integration test, package export), the admin
  `settlement` mock + vitest alias, nav entry and `/settlements` redirects (landing → `/partners`),
  the unused `_count.settlements` on the partners page; docs, agent, playbook, `/db` command and
  wiki pages retired. Schema untouched apart from a `// LEGACY` comment.
- ✅ **Step 2 (contract, 2026-10-13)** — migration `20261013101617_drop_legacy_settlement` drops
  `"Settlement"`, `"Invoice".settlement_batch_id` and `SettlementStatus` (generated with
  `migrate diff --script`; `migrate:check` clean); `deleteUser` cleanup, its two test cases and the
  admin + partner Prisma-mock `settlement` entries removed; docs say the table is gone.

## Log

- **2026-10-13** — Found by track 031 P5 verification (settlement selection ignored rental,
  deposit and tab invoices). Founder confirmed the feature is legacy; retired instead of fixed.
  Admin 225 tests and `@repo/data` 1,206 unit tests green; both typechecks clean (admin needed its
  generated `.next/types` refreshed after the route was deleted).
- **2026-10-13** — Step 1 shipped: promoted to test (`e8959fe`, all 4 builds Ready) and deployed to
  production together with the 43-commit test backlog (Next 16/React 19, partner AI assistant,
  GA4 — founder-approved); prod migrate had nothing pending (the assistant migrations were already
  applied). Step 2 written and verified the same day: admin 224, partner 3,362, data 1,206 tests.

## Links

- [[track:031-context-system-v2]] — where the finding came from
- [[subsystem:payments]] — the direct-charge model that made settlements obsolete
