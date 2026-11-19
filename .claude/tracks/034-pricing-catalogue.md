---
id: 034-pricing-catalogue
title: Gratis / Temporada / Grupo pricing catalogue replaces Starter / Pro / Business (CR-002)
status: done
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

- **CR-002 done in run 5 (T-148).** Gating, hamaca limits, cards and copy are committed on
  `co/CR-002-pricing-catalogue`. The founder merges and releases.
- Follow-ups need a new CR or founder decision; see the CR's "Remaining open questions": the upgrade path from
  Gratis to Temporada, the deposit policy on Gratis restaurants, wiring the refund to
  `reverseCappedCommission`, M-68 Viva at the cap, the marketing copy.

## Roadmap

- ✅ **Run 1 (2026-11-19):** CR filed, claims verified, Q1-3/6/7 answered.
- ✅ **Run 2 (2026-11-19):** expand migration `20261119140500_pricing_catalogue_expand` (nullable
  `SubscriptionPlan.max_hamacas_per_site` and `monthly_commission_cap_per_site`,
  `CustomSubscription.max_hamacas_per_site`, table `commission_cap_entry`) plus `src/commission-cap.ts`,
  with unit and integration tests: below, at and above the cap; a booking crossing it; refund; month
  rollover; per site; concurrency; collected = invoiced.
- ✅ Run 3 (2026-11-19, T-146): enum `@map`, catalogue, subscription, seed, data-move migration, consumers.
- ✅ Run 4 (2026-11-19, T-147): cap wired into Mollie, Stripe, Viva and the invoices; Tap to Pay 0 commission.
- ✅ Run 5 (2026-11-19, T-148): plan gate on every charge path, hamaca limits, settings gates, cards and copy, CR done.

## Log

- 2026-11-19 run 5: a partner with no subscription resolves to Gratis, so every pre-CR-002 partner integration
  test that saves a paid site or a 200-seat parcel broke. `createTestPartnerAccount` (apps/partner fixtures) now
  grants an entitling CustomSubscription; `{ planGated: true }` gives a bare Gratis partner. `Site.type` is
  nullable, and null counts as "not paid", so saving `paid` on a fixture site is a gated transition.

- 2026-11-19 run 4: the parity test calls the charge paths for one reservation in sequence (Viva intent, Stripe
  intent, Mollie). Every call after the first reuses the same `reservation:<id>` entry, which shows the idempotency
  that makes collected = invoiced. A rental group's ledger key is its lowest booking id, because the paymentRef does
  not exist yet when the charge is created.

- 2026-11-19 run 3: seed runs found the DB already right after the data move (0 rows written twice):
  migration and seed agree. `tsx` CLI fails in the sandbox (IPC pipe EPERM); `node --import <tsx>/dist/loader.mjs` works.

- 2026-11-19 run 2: the ledger decides the capped amount once, at charge creation, under
  `pg_advisory_xact_lock(hashtext('commission-cap:'||site||':'||month))`, and the invoice reads it back.
  A pure per-charge rule cannot stay equal at both ends once a running total is involved.
