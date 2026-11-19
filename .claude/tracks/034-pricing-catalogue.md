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

- **Next action (run 3):** the enum. Rename the Prisma enum values with `@map` (`GRATIS @map("STARTER")`,
  `TEMPORADA @map("PRO")`, `GRUPO @map("BUSINESS")`): no DDL, and old deployed clients keep reading the
  same labels, so the change is single-release and expand-safe on the shared TEST DB. This supersedes the
  R1/R2/R3 plan in the CR's Q2 answer. Then rewrite `pricing-tiers.ts` (per-service-code commission,
  `maxHamacasPerSite`, `monthlyCommissionCapPerSite`, `FEATURED_TIER = 'TEMPORADA'`, Grupo `quoteOnly`)
  and `subscription.ts`: features `ONLINE_PAYMENTS` and `FOOD_AND_BEVERAGE`, Gratis as the default,
  `OFF_PLATFORM_BILLING` true on every plan, the hamaca limit in `resolveEffectiveSubscription`, and
  `handleSubscriptionCanceled` keeping the current plan instead of dropping to Gratis. Then update the
  seed and write a data-move migration: plan rows; fee rows, including F&B at 0%; `STARTER`→`TEMPORADA`
  when any site has `type='paid' AND app_sales_enabled`; `BUSINESS`→`TEMPORADA`; NULL the plans' Stripe
  price ids. Then fix every consumer (about 40 files, listed by `grep -rln "STARTER\|BUSINESS\|PRICING_TIER"
  apps packages`) until all workspaces typecheck.
- **Then (run 4):** wire `@repo/data/commission-cap` into the charge and invoice paths. Reserve in
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
- ⏳ Run 3: enum `@map`, catalogue, subscription, seed, data-move migration, consumers.
- ⏳ Run 4: cap wired into Mollie, Stripe, Viva and the invoices.
- ⏳ Run 5: limits, gating, copy, cards, guard test, review, CR closed.

## Log

- 2026-11-19 run 2: the ledger decides the capped amount once, at charge creation, under
  `pg_advisory_xact_lock(hashtext('commission-cap:'||site||':'||month))`, and the invoice reads it back.
  A pure per-charge rule cannot stay equal at both ends once a running total is involved.
