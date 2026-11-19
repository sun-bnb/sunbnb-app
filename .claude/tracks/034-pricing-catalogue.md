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

- **Done in run 3 (T-146):** enum `@map`, catalogue, features, seed, data-move migration
  `20261119150000_pricing_catalogue_data_move`, consumers. Every workspace typechecks (apps/user's
  14 image-module errors predate this branch: no `next-env.d.ts` in the clone).
- **Next action (run 4):** partner unit tests were renamed to the new tier literals but NOT run;
  run `cd apps/partner && npm test` first and fix value assertions (old 6% / OFF_PLATFORM false on
  Starter, `inspect.test.ts` ladder). The live Stripe subscriptions still need cancel-at-period-end in
  Stripe (founder, outside the app).
- **Then (run 4, after the tests):** wire `@repo/data/commission-cap` into the charge and invoice paths. Reserve in
  `reservation-payment.ts`, `rental-payment.ts`, `checkout.ts`, the user app's Mollie
  `create-rental-payment` route and `reservation-machine-apply.ts` (Viva, Tap to Pay). Take in
  `processConfirmedReservation` and `processConfirmedRentalBooking`. Release from `/api/reservations-cleanup`
  and the failed-payment webhooks. Reverse on refunds that return the application fee. Cap only when
  `isPlanRateFee(fee)`. Extend `payment.commission-parity.integration.test.ts`.
- **Then (run 5):** the hamaca limit (inventory create, import, layout, copy site), plan gating as a server
  check on every charge path (C3 in the CR), cards, the site create and site general fee breakdown,
  en/es/fi copy, the guard test, fixtures, `/review`.
- **Open question (founder):** card-present payments (Viva terminal, Tap to Pay) are "card at the venue".
  The prompt says those carry no commission; today they do. See the CR.

## Roadmap

- ✅ **Run 1 (2026-11-19):** CR filed, claims verified, Q1-3/6/7 answered.
- ✅ **Run 2 (2026-11-19):** expand migration `20261119140500_pricing_catalogue_expand` (nullable
  `SubscriptionPlan.max_hamacas_per_site` and `monthly_commission_cap_per_site`,
  `CustomSubscription.max_hamacas_per_site`, table `commission_cap_entry`) plus `src/commission-cap.ts`,
  with unit and integration tests: below, at and above the cap; a booking crossing it; refund; month
  rollover; per site; concurrency; collected = invoiced.
- ✅ Run 3 (2026-11-19, T-146): enum `@map`, catalogue, subscription, seed, data-move migration, consumers.
- ⏳ Run 4: cap wired into Mollie, Stripe, Viva and the invoices.
- ⏳ Run 5: limits, gating, copy, cards, guard test, review, CR closed.

## Log

- 2026-11-19 run 3: seed runs found the DB already right after the data move (0 rows written twice):
  migration and seed agree. `tsx` CLI fails in the sandbox (IPC pipe EPERM); `node --import <tsx>/dist/loader.mjs` works.

- 2026-11-19 run 2: the ledger decides the capped amount once, at charge creation, under
  `pg_advisory_xact_lock(hashtext('commission-cap:'||site||':'||month))`, and the invoice reads it back.
  A pure per-charge rule cannot stay equal at both ends once a running total is involved.
