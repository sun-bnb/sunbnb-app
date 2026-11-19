---
id: 034-pricing-catalogue
title: Gratis / Temporada / Grupo pricing catalogue replaces Starter / Pro / Business (CR-002)
status: active
created: 2026-11-19
updated: 2026-11-19
worktree: null
---

## Goal

Ship the founder-decided price model (CR-002, `.claude/company-requests/002-pricing-catalogue.md`):
Gratis (EUR 0, 1 site, 100 hamacas, pay on site only, no F&B), Temporada (2% on online sunbed and
rental bookings, capped at EUR 199 per site per Madrid calendar month, 3 sites, 300 hamacas, 0% F&B),
Grupo (quote only, custom limits). No guest fee, ever. Card processing is its own line. The launch
offer and its admin grant are OUT (M-65 / F-19). Branch `co/CR-002-pricing-catalogue`.

## Resume here

- **Done in run 4 (T-147):** the cap is wired through `cappedCommission('reserve'|'take')` (`payment.ts`). It
  covers Mollie (reservation, rental, the user-app rental route), `checkout.ts` (Stripe, Viva online), the Viva
  terminal sale and both `processConfirmed*` invoice paths. Tap to Pay takes no commission (default (c), M-68
  unanswered). The cleanup cron releases abandoned entries. Evidence: `payment.commission-cap-parity.integration.test.ts`.
  The partner suite is green after the run-3 assertion fixes.
- **Next action (run 5):** wire `reverseCappedCommission` into refunds that return the application fee
  (`refund.ts`, Stripe `refund_application_fee`, Mollie route reversal). Then the hamaca limit (inventory create,
  import, layout, copy site), plan gating as a server check on every charge path (C3 in the CR), cards, the site
  create and site general fee breakdown, en/es/fi copy, the guard test, fixtures, `/review`.
- **Open (founder):** M-68 card-present. Under default (c), a Viva venue at its monthly cap cannot take Viva card
  payments (Viva refuses a zero ISV fee) until Viva confirms zero-ISV. See the CR's run-4 section.
- The live Stripe subscriptions still need cancel-at-period-end in Stripe (founder, outside the app).

## Roadmap

- ✅ **Run 1 (2026-11-19):** CR filed, claims verified, Q1-3/6/7 answered.
- ✅ **Run 2 (2026-11-19):** expand migration `20261119140500_pricing_catalogue_expand` (nullable
  `SubscriptionPlan.max_hamacas_per_site` and `monthly_commission_cap_per_site`,
  `CustomSubscription.max_hamacas_per_site`, table `commission_cap_entry`) plus `src/commission-cap.ts`,
  with unit and integration tests: below, at and above the cap; a booking crossing it; refund; month
  rollover; per site; concurrency; collected = invoiced.
- ✅ Run 3 (2026-11-19, T-146): enum `@map`, catalogue, subscription, seed, data-move migration, consumers.
- ✅ Run 4 (2026-11-19, T-147): cap wired into Mollie, Stripe, Viva and the invoices; Tap to Pay 0 commission.
- ⏳ Run 5: limits, gating, copy, cards, guard test, review, CR closed.

## Log

- 2026-11-19 run 4: the parity test calls the charge paths for one reservation in sequence (Viva intent, Stripe
  intent, Mollie). Every call after the first reuses the same `reservation:<id>` entry, which shows the idempotency
  that makes collected = invoiced. A rental group's ledger key is its lowest booking id, because the paymentRef does
  not exist yet when the charge is created.

- 2026-11-19 run 3: seed runs found the DB already right after the data move (0 rows written twice):
  migration and seed agree. `tsx` CLI fails in the sandbox (IPC pipe EPERM); `node --import <tsx>/dist/loader.mjs` works.

- 2026-11-19 run 2: the ledger decides the capped amount once, at charge creation, under
  `pg_advisory_xact_lock(hashtext('commission-cap:'||site||':'||month))`, and the invoice reads it back.
  A pure per-charge rule cannot stay equal at both ends once a running total is involved.
