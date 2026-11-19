---
id: CR-002
title: Replace the Starter / Pro / Business plans with Gratis, Temporada and Grupo
status: in-progress
priority: 2
company_ref: A-22 (approved prompt), A-23 / A-28 (build approvals), T-130, F-9 (pricing decision)
created: 2026-11-19
track: .claude/tracks/034-pricing-catalogue.md
outcome: In progress. Run 1 filed the CR and answered the open questions. Run 2 committed the expand migration and the commission-cap ledger. Run 3 (T-146) committed the enum @map, the Gratis/Temporada/Grupo catalogue, plan features, the seed and the data-move migration; every workspace typechecks. Runs 4-5 follow track 034.
---

# CR-002: Gratis / Temporada / Grupo pricing catalogue

The approved prompt (share A-22) is copied verbatim under **Prompt** at the end. The engineer's findings come first.

## Re-verification (run 1, against `app/main` @ 1a9f6572)

These prompt claims match the code: `SubscriptionTier { STARTER PRO BUSINESS }` (schema.prisma:9), `SubscriptionPlan`,
`Subscription`, `ServiceFee.subscriptionTier`, `CustomSubscription`, the `resolveServiceFee` cascade (payment.ts:88),
`serviceFeeForUnits` (payment.ts:137), and the `OFF_PLATFORM_BILLING` gate (site-actions.ts:141, 234;
`TIER_FEATURE_DEFAULTS` subscription.ts:52-54).

**Contradictions and extra findings (they change the design):**
- **C1. The commission is computed twice, at two different times.** Charge time: `reservation-payment.ts:147`,
  `rental-payment.ts:175`, `checkout.ts:130`, `apps/user/app/api/{order,tab}-payment/mollie/create-payment`,
  `create-rental-payment`, `reservation-machine-apply.ts:685`. Invoice time: `processConfirmed*` (payment.ts:709,
  1158, 1599, 1892, 2180, 2318). Today these always agree because the rule is pure. A running monthly cap makes the
  rule depend on state, so the two calls could disagree and collected would no longer equal invoiced. No column stores
  the fee taken at charge time.
- **C2. `InventoryItem.category` is a price category, not a furniture type.** TEST holds `standard`, `PRICE1`,
  `STANDARD`, `POOL`, `FRONT`, `FAMILY` and null. No column distinguishes a balinese bed from a sunbed. A parasol is not
  a row: it is the `SunbedGroup` unit, and an `InventoryItem` is one seat (`unit.ts`: "an empty unit means the parasol
  was dismounted").
- **C3. Server-side charge creation does not check the site's payment mode.** None of the payment-creation routes
  (`api/payment`, `api/order-payment`, `api/tab-payment`, `api/table-reservations/[id]/deposit`, `checkout.ts`,
  `rental-payment.ts`, `reservation-payment.ts`) reads `Site.type`, `orderPaymentType` or `rentalPaymentType`. Only the
  guest UI does. Tabs and table deposits belong to a restaurant (`Restaurant.partnerAccountId`), not always to a site.
- **C4. TEST data is already over the new limits.** A Starter partner has 2 sites with up to 195 seats. The Pro partner
  has 5 sites with up to 4,040 seats (looks like scale-test data). So Q4 is a real decision, not a hypothetical one.

## Answers to open questions

**Q1. Cap at charge time.** It can be done without double counting, but not with a pure per-charge rule. Proposal:
- A new ledger table `CommissionCapUsage(siteId, month 'YYYY-MM' in venue tz, reserved, taken)`, unique
  `(siteId, month)`. At charge creation, inside one transaction holding `pg_advisory_xact_lock` on (site, month), read
  the headroom (`199 - taken - reserved`) and compute `fee = min(planRate x total, headroom)`. Reserve that amount and
  **store it on the payable** (new nullable `commissionAmount` on Reservation / RentalBooking group / Order). This is
  expand-only.
- Invoicing (`processConfirmed*`) reads the stored `commissionAmount` instead of recomputing it, so collected equals
  invoiced for Mollie `applicationFee`, Stripe `application_fee_amount` and Viva `isvAmount` alike. It then moves the
  amount from reserved to taken.
- A failed or expired payment releases the reservation. The stale-booking cron (`/api/reservations-cleanup`) is the
  sweep. A refund that reverses the commission (Stripe `refund_application_fee`, Mollie route reversal) subtracts it
  from taken.
- No month-end true-up is needed, because every amount is decided at charge time. One edge is accepted: a payment
  created on the 31st and confirmed on the 1st counts against the month it was **created** in.
- Month = calendar month in `Site.timezone` if set, else Europe/Madrid.
- Negotiated site or account fees bypass the cap (the prompt's default). Plan-rate fees only are capped.

**Q2. Enum migration.** `ALTER TYPE ... ADD VALUE` is safe. The catch is the shared TEST database: older deployed code
(test.sunbnb.app) has a Prisma client that does not know the new values, and Prisma fails to read a row holding an
unknown enum value. So the **data** cannot move until every deployed client knows the new values. Plan:
1. **R1, expand** (apply to TEST before `main` is pushed): migration A adds `GRATIS`, `TEMPORADA` and `GRUPO`, nothing
   else. It also adds the new nullable columns (`SubscriptionPlan.maxHamacasPerSite`,
   `monthlyCommissionCapPerSite`, `CustomSubscription.maxHamacasPerSite`, the `commissionAmount` columns, the
   `CommissionCapUsage` table, the launch-offer fields). The new code understands both old and new values
   (`LEGACY_TIER_MAP` in `pricing-tiers.ts`) and writes only new ones. The seed does **not** create new plan rows yet.
2. **R2, data move** (applied at promote, like a contract, once test runs R1 code; production at deploy): migration B
   inserts the three new plans and their platform fees, remaps `Subscription.planId` and tier fee rows per Q3, and
   cancels legacy fee rows. It is idempotent (`ON CONFLICT DO NOTHING` / `WHERE NOT EXISTS`).
3. **R3, contract**: recreate the enum without `STARTER`, `PRO` and `BUSINESS` (Postgres cannot drop a value), delete
   the old plan and fee rows, and remove `LEGACY_TIER_MAP`.

**Q3. Existing partners (TEST database; production is not reachable from this sandbox).**
- TEST: 3 partners. 2 are on STARTER with no Stripe subscription. 1 is on **PRO with an ACTIVE Stripe subscription**
  (`sub_...`, period end 2026-12-03, an internal-looking account, almost certainly Stripe **test mode**). There are no
  CustomSubscription rows and no site or account fee rows. The tier fee rows are platform-wide only (STARTER 6%,
  PRO 3%, BUSINESS 1.5% on all three codes, plus tier-null fixed EUR 1 defaults).
- **Stop condition:** this run cannot see production. **The founder must check the production `Subscription` table for
  rows with `stripe_subscription_id` set before migration B is written.** Building stays paused on that check.
- Proposed mapping, chosen so no one's cost rises and no one loses a working feature:
  - STARTER with any online-paid site (`type='paid' AND app_sales_enabled`) → **Temporada** (6% → 2% capped; keeps
    card payments).
  - STARTER without online sales → **Gratis**.
  - PRO → **Temporada**. The Stripe subscription is cancelled at period end with no further monthly charge, and the
    partner gets a notice email. Whether to refund the current period is a founder call.
  - BUSINESS → **Temporada**, unless the partner has more than 3 sites or more than 300 seats on a site. Then it goes
    to **Grupo** with a `CustomSubscription` that keeps the old 10-site limit. Above about EUR 15,800 a month in online
    volume, Temporada at 2% costs more than Business (79 + 1.5%). Any such partner should get Grupo with an account
    fee of 1.5% so the cost does not rise.

**Q6. Gratis and off-platform.** Yes: `Site.type = 'unpaid'` (with `orderPaymentType` / `rentalPaymentType`) is the
right expression for a site. But the gate has to be **plan-derived and server-enforced**, not a per-site flag alone.
- A Gratis site is forced to `unpaid`, and the plan check moves into `@repo/data` as
  `canTakeOnlinePayment(account)`.
- Every charge-creating path (C3) must call that check, including tabs and deposits resolved through
  `Restaurant.partnerAccountId`. Today any guest flow that reaches those routes directly can take a card payment for an
  unpaid site.
- `OFF_PLATFORM_BILLING` inverts: unpaid mode is allowed on every plan and is the default on Gratis.

**Q7. Hamaca count.** Count the site's `InventoryItem` rows (one row = one lounger), not filtered by `category` (C2).
- `SunbedGroup` / parasols do not add to the count. Two seats under one parasol = 2 rows = 2, which matches the rule.
- Open point: unplaced "pool" seats (`unit.ts:15`). Proposal: they count, because they are bookable inventory.
- There is no balinese-bed type in the data, so a balinese bed counts as 1 automatically (as one row). If it is ever
  modelled as a multi-seat item, this needs revisiting.

## Founder decisions (M-65, 2026-11-19)

1. **No paying subscriptions in production.** Mapping: STARTER→**Gratis**, or **Temporada** when online sales are on
   (any site with `type='paid' AND app_sales_enabled`). PRO and BUSINESS→**Temporada**. Every Stripe subscription
   cancels at period end, with no refund.
2. **Over-limit venues are grandfathered.** They keep everything they have and cannot add more. Nothing is deleted or
   hidden.
3. **Launch offer dropped entirely** (F-19). No free Temporada for the first five venues, no 0% grant mechanism, no
   `validUntil` column. Change-list item 9 and its acceptance line are out of scope.
4. **Cap month** = the Europe/Madrid calendar month in which the payment was created. This replaces the run-1
   proposal of the site's own timezone.

## Design revisions (run 2)

- **Q2 (enum), revised.** Rename the Prisma enum values with `@map` instead of adding new ones:
  `GRATIS @map("STARTER")`, `TEMPORADA @map("PRO")`, `GRUPO @map("BUSINESS")`. There is no DDL on the enum, and
  clients already deployed on the shared TEST database keep reading the same labels. The three-release R1/R2/R3 dance
  is therefore not needed: one expand release carries the code and an idempotent data-move migration. The database
  keeps the legacy labels as storage keys, while plan rows carry the new names. Renaming the labels themselves
  (`ALTER TYPE ... RENAME VALUE`) is optional later cleanup and would need code and database to switch in the same
  release.
- **Q1 (cap), built.** Migration `20261119140500_pricing_catalogue_expand` adds the nullable
  `SubscriptionPlan.max_hamacas_per_site`, `SubscriptionPlan.monthly_commission_cap_per_site` and
  `CustomSubscription.max_hamacas_per_site`, plus the table `commission_cap_entry` (one row per payable). This is the
  expand class: additive only. `@repo/data/commission-cap` decides the capped amount once, at charge creation, under
  an advisory lock on (site, month). The invoice reads that amount back, a failed or expired charge releases it, and
  a refund that reverses commission lowers it. The ledger replaces the run-1 idea of a `commissionAmount` column on
  each payable.
- **Open: card-present payments.** The prompt says bookings the guest pays at the venue ("cash or card at the venue")
  carry no Sunbnb commission. Today, card-present sales (Viva Cloud Terminal, Stripe Tap to Pay in `apps/mobile`)
  take the `sunbed-rental` commission. Following the prompt would mean a zero ISV fee on Viva, which is the
  unresolved Viva question in track 024 (Q2/Q3). The code currently refuses a waived-fee Viva sale rather than send
  0. Default unless the founder says otherwise: Tap to Pay takes no commission (processing pass-through only), and
  Viva keeps its current fee until Viva confirms a zero ISV fee.

## Founder decisions needed in run 1 (answered by M-65 above)
1. **Production paid subscriptions** (Q3 stop condition): check them, and decide whether to refund the current period
   for PRO.
2. **Q4, venues over the limit**: the default is to grandfather them (block adding, never delete). TEST shows this is
   common (C4). Confirm.
3. **Q5, launch offer mechanism**: proposed is a dated account-level `ServiceFee` at 0% (`validUntil`, new nullable
   column), ignored by `resolveServiceFee` after expiry and listed on the admin partner page. Confirm.
4. **Q1 boundary**: a payment counts toward the month it was created in, not the month it was confirmed. Confirm.

## Run 3 (T-146, 2026-11-19)

- `SubscriptionTier` is `GRATIS @map("STARTER")`, `TEMPORADA @map("PRO")`, `GRUPO @map("BUSINESS")`. `migrate:check` is clean.
- `pricing-tiers.ts`: per-service-code `commissionPercent` (F&B 0% on every plan), `maxHamacasPerSite` (100 / 300 / null),
  `monthlyCommissionCapPerSite` (Temporada 199; Grupo defaults to Temporada terms until negotiated), `quoteOnly`,
  `DEFAULT_TIER = GRATIS`, `FEATURED_TIER = TEMPORADA`, `CAPPED_SERVICE_CODES`, `GRUPO_DEFAULT_MAX_SITES = 10` (plan-row fallback).
- `subscription.ts`: features `ONLINE_PAYMENTS` and `FOOD_AND_BEVERAGE` (off on Gratis), `OFF_PLATFORM_BILLING` on for every plan,
  hamaca limit and cap in `resolveEffectiveSubscription`, `handleSubscriptionCanceled` keeps the plan.
- Migration `20261119150000_pricing_catalogue_data_move` (data move, no DDL, expand-safe, idempotent): plan rows, M-65 subscription
  mapping, platform fee rows, NULLs the plans' Stripe ids. **Not done by SQL:** setting the live Stripe subscriptions to cancel at
  period end. That is a Stripe action outside this sandbox.
- Interim card lines in partner `landing.tsx` / `account/subscription/view.tsx` and admin; real copy in run 5. Marketing projection
  now uses Temporada 2% capped; its FAQ copy (`Faq.costA`) still names Starter/Pro/Business (run 5 copy pass).

## Build plan (later runs)
- Run 2: catalogue + `LEGACY_TIER_MAP`, migration A (expand), seed, `CommissionCapUsage` + stored `commissionAmount`,
  invoice reads the stored fee, cap tests.
- Run 3: hamaca limit, plan gating (server checks on every charge path), fee breakdown copy, plan cards en/es/fi,
  checkout route retired for the new plans.
- Run 4: admin grant, guard test + fixtures, full unit/integration suites, `/review`, migration B drafted (not applied).

---

## Prompt (A-22, verbatim)

## Task: replace the Starter / Pro / Business plans with Gratis, Temporada and Grupo

### Why
The founder decided a new public price model on 2026-11-19 (decision F-9). The old ladder (Starter 0 / Pro 29 / Business 79 per month, with 6 / 3 / 1.5% commission on every purchase) is a placeholder: it charges the smallest venue the highest rate and takes a cut of food and drink. Beach venues in Spain run on thin food margins and guests have objected to extra fees, so the new model has a free entry plan, a single capped commission on sunbed and rental sales, no commission on food and drink, and never a guest fee. Until this ships, the partner site must not show prices that differ from the decided ones, so this change is on the critical path for the 2027 season (venues choose tools in March–April 2027).

All prices below are **excluding IVA** (the existing VAT handling stays as it is).

### The decided model

| | **Gratis** | **Temporada** | **Grupo** |
|---|---|---|---|
| Price | EUR 0 | 2% of online-paid sunbed and rental bookings, **capped at EUR 199 per site per month**. No fixed monthly fee. | No public price. Card shows "Pide presupuesto" (es) / "Request a quote" (en) / Finnish equivalent, linking to a contact action. Negotiated one venue at a time. |
| Sites | 1 | up to 3 | set per agreement (custom) |
| Hamacas per site | up to 100 | up to 300 | set per agreement (custom) |
| Sunbed booking, satellite sunbed map, QR booking without guest account, staff link, equipment rentals | yes | yes | yes |
| Guests pay | on site only | online by card or on site | as agreed |
| Online card payment | **no** | **yes** | yes |
| Food and drink (F&B) ordering | **no** | **yes** | yes |
| Commission on F&B | n/a | **0%** | 0% |

Rules for all plans:
- **A "hamaca" is one lounger.** Each sunbed (hamaca) or balinese bed (cama balinesa) counts as 1. Parasols do not count. Two sunbeds sharing a parasol count as 2.
- **No commission on food and drink, on any plan.**
- **Card processing is billed at the provider's cost and shown as its own line**, separate from the Sunbnb commission. (The app already has a "commission plus processing" policy for Stripe and a processing-fee pass-through; keep that behaviour and make sure the plan cards and the venue's fee breakdown describe them as two separate things.)
- **Never a guest-paid fee or surcharge.** The total the guest sees is the venue's price.
- The commission applies only to **online-paid** sunbed bookings and equipment rentals. Bookings the guest pays on site (cash or card at the venue) carry no Sunbnb commission.
- The cap: in any calendar month, the sum of commission Sunbnb takes on sunbed and rental bookings for one site never exceeds EUR 199. The cap is per site, not per account.

Plan names shown to partners: **Gratis**, **Temporada**, **Grupo** (these are the same in all languages; descriptions are translated). Temporada is the featured plan.

### Current behaviour (read from the app on 2026-11-19; re-verify before you edit, stop and say so if the code differs)
- `packages/data/src/pricing-tiers.ts`: `PRICING_TIERS` has `STARTER` (0 / 1 site / 6%), `PRO` (29 / 3 sites / 3%) and `BUSINESS` (79 / 10 sites / 1.5%), each with `name`, `monthlyPrice`, `maxSites`, `commissionPercent`. Also `PRICING_TIER_ORDER`, `FEATURED_TIER = 'PRO'` and `COMMISSIONED_SERVICE_CODES` = `sunbed-rental`, `food-and-beverage`, `equipment-rental`. The file says it is a seed source and not read while charging.
- `packages/data/prisma/schema.prisma`: `enum SubscriptionTier { STARTER PRO BUSINESS }`; `SubscriptionPlan` (tier unique, name, monthlyPrice, maxSites, Stripe product/price ids); `Subscription` (partner account, plan, status, Stripe ids, period dates); `ServiceFee` (settings, optional site, optional account, optional `subscriptionTier`, `chargeType` 'percentage' or 'fixed', `feeAmount`, `percentage`, `serviceCode`, optional `product`); `CustomSubscription` (per partner: optional `maxSites`, `featureOverrides` JSON); `PaymentProcessingFee`.
- `packages/data/prisma/seed-subscriptions.ts`: upserts one `SubscriptionPlan` per tier from `PRICING_TIERS`, writes one platform `ServiceFee` per Settings row × service code × tier (percentage), and `backfill-starter-subscriptions.ts` plus a seed step give partners without a subscription the STARTER plan.
- `packages/data/src/payment.ts`: `resolveServiceFee` picks the fee in the order site fee, partner-account fee, platform fee for the partner's tier, platform fee with no tier. `serviceFeeForUnits` is "the commission rule" used by every charge-time fee (Mollie `applicationFee`, Stripe `application_fee_amount`, Viva) and by the platform invoices, so what is collected equals what is invoiced; a percentage fee is taken once on the total paid. Charge paths: `processConfirmedReservation`, `processConfirmedRentalBooking`, `processCashRentalBooking`, `processConfirmedOrder`, `processChargedTableDeposit`, `calculateOrderServiceFee`, `processConfirmedTabPayment`; callers in `apps/user/app/api/**/mollie/**` and `packages/data/src/stripe/checkout.ts`.
- `packages/data/src/payment-providers/fee-policy.ts`: Stripe application fee = commission + an estimate of processing cost, capped just under the charge amount.
- `packages/data/src/subscription.ts`: `SUBSCRIPTION_FEATURES` (only `OFF_PLATFORM_BILLING`), `TIER_FEATURE_DEFAULTS` per tier, `resolveEffectiveFeatures`, `resolveEffectiveSubscription` (custom `maxSites` wins over the plan), `canCreateSite` (the only limit checked today is the number of sites). Nothing limits the number of hamacas.
- Site payment behaviour is set per site in `Site` (`type`, `rentalPaymentType`, `orderPaymentType`, `appSalesEnabled`). `apps/partner/app/sites/[id]/site-actions.ts` (around line 141 and 234) blocks switching a site to the unpaid/off-platform type unless the plan has `OFF_PLATFORM_BILLING`. Today the old Starter plan **cannot** use off-platform (unpaid) mode and Pro/Business can; under the new model it must be the other way round for the free plan (see below).
- Sunbeds are `InventoryItem` rows per site (with `category`, `SunbedGroup`/`ItemGroup` relations); the hamaca count for a site is derived from these.
- Readers of the catalogue: `apps/partner/app/landing.tsx` (plan cards), `apps/partner/app/account/subscription/view.tsx` (in-app cards, "Free tier" label for STARTER, `TIER_FEATURES`/`TIER_COLORS`), `apps/partner/app/sites/create/step-details.tsx` and `apps/partner/app/sites/[id]/general/view.tsx` (price breakdown and "upgrade to next tier for a better fee" hint), `apps/partner/app/api/subscription/checkout/route.ts` (refuses to "purchase" STARTER) and `apps/partner/app/api/subscription/webhook/route.ts`; admin screens `apps/admin/app/fees/*` and `apps/admin/app/partners/**`. Guard test: `apps/partner/app/test/no-hardcoded-tier-pricing.test.ts` (forbids tier-keyed price literals in partner source and keys on `STARTER|PRO|BUSINESS`). Other tests: `packages/data/src/subscription.test.ts`, `payment.commission-parity.integration.test.ts`, `fee-context.integration.test.ts`, `apps/partner/app/test/auth-matrix.test.ts`, `apps/partner/app/test/fixtures.ts`.

### The change
1. **Catalogue.** Replace the three tiers with Gratis, Temporada and Grupo in `pricing-tiers.ts` (names, `maxSites`, new `maxHamacasPerSite`, commission percent, new `monthlyCommissionCapPerSite`, featured plan = Temporada). Gratis: 0 commission, cap n/a. Temporada: 2% on the sunbed and rental service codes, 0% on `food-and-beverage`, cap EUR 199 per site per month. Grupo: no public price or limits in the catalogue (quote-only); limits and fees come from per-partner custom values. Keep `COMMISSIONED_SERVICE_CODES` but make the commission percentage **per service code** so F&B can be 0% on every plan.
2. **Enum and data.** Replace or map the tier enum so the database holds Gratis, Temporada, Grupo. Decide the migration (see open questions); follow the repo's expand/contract rules since `main` and `test` share one database.
3. **Seed.** `seed-subscriptions.ts` writes exactly the new plans and platform fees (including zero-percent F&B rows), idempotent, still never touching negotiated site or account fees. Partners with no subscription get Gratis.
4. **Commission cap (new code).** In `serviceFeeForUnits` or at the point where the commission is computed for a charge, apply the monthly per-site cap: commission for a booking = min(2% of the booking, EUR 199 minus commission already taken for that site in the same calendar month, never below 0). Define "month" (calendar month in the venue's timezone, Europe/Madrid unless the site has its own) and how the running total is read (sum of commission on completed charges for that site in the month, so refunds that reverse a commission reduce it). It must be applied consistently to Mollie `applicationFee`, Stripe `application_fee_amount`, Viva `isvAmount` **and** the platform invoice, keeping the rule that collected equals invoiced. Negotiated site or account fees keep winning over the plan rate, and the cap applies only to plan-rate commission unless the negotiated record says otherwise (ask if unclear).
5. **Hamaca limits (new code).** Add a per-plan limit on hamacas per site (Gratis 100, Temporada 300; custom value for Grupo through the existing custom subscription). Enforce it where a venue adds or places sunbeds (layout editor, inventory create/import, copy site). When the limit is reached, say so in plain language and offer the upgrade; do not delete or hide existing sunbeds of a venue already over the limit (see open questions), just block adding more. Parasols are not counted.
6. **Plan gating.** Gratis: guests can book and pay **on site only**, so the online-payment options and F&B ordering (menu, orders, tabs, table deposits that take card payment) are unavailable for sites of a Gratis partner, in the partner settings and in the guest-facing flows. Temporada and Grupo: available. Rework the `OFF_PLATFORM_BILLING` rule so that "availability only, pay on site" is the normal mode of a Gratis site and never blocked for it. Show an upgrade prompt where a Gratis partner looks at a gated setting. A venue that upgrades gets the features immediately; one that downgrades keeps its data, loses the gated features, and any open online payments or orders still settle.
7. **Fees shown to venues.** Update the price breakdown on site create and site general so it shows: commission (2% on sunbeds and rentals, with the cap noted), 0% on food and drink, and card processing as a separate line at provider cost. Replace the "upgrade for a better fee" hint (the ladder no longer works that way) with plan-appropriate copy. Remove any text that implies a guest fee.
8. **Plan cards and landing.** Partner landing and in-app subscription cards show the three plans with the table above (names, limits, what is included), in Spanish, English and Finnish (i18n keys, no new hard-coded strings; keep the existing parity test passing). Grupo's card has a quote request action instead of a price and no checkout. Temporada has no fixed price, so the card shows the commission rule instead of a monthly amount; the subscription checkout route must not create a paid Stripe subscription for Temporada (there is nothing to bill monthly) unless you find a reason it must; if the checkout flow only exists to bill a monthly price, retire its use for these plans and say what you did.
9. **Launch offer, supported but not shown.** The company will give Temporada free for the 2027 season to its first five venues. Provide a way for an admin to grant a partner Temporada at 0% commission until a given date (for example a time-limited partner-account fee of 0% or a dated promotion record), visible in the admin partner page, expiring on its own, and not shown on the public cards or landing.
10. **Tests and the guard.** Update the guard test to the new tier keys and keep its intent (no price literals outside the catalogue). Update fixtures and mocks. Add tests for the cap (below, at, above the cap; two bookings crossing it; refund; month rollover; two sites of one partner), the hamaca limit, the plan gating and the zero F&B commission.

### Acceptance criteria
- The seed produces exactly three plans (Gratis, Temporada, Grupo) and platform fee rows for all commissioned service codes, with F&B at 0% on every plan; re-running it changes nothing.
- A booking of EUR 100 online on Temporada takes EUR 2.00 commission; once a site has EUR 199 of commission in a calendar month, further online sunbed and rental bookings that month take 0; the next month starts at 0 again. Mollie, Stripe and Viva paths and the platform invoice all agree to the cent.
- An F&B order on any plan takes 0 commission. Card processing is a separate, labelled line. No guest-facing total contains any Sunbnb fee.
- A Gratis partner cannot add a 101st hamaca to a site, cannot create a second site, and cannot enable online card payment or F&B ordering; a Temporada partner can have 3 sites and 300 hamacas per site and cannot exceed them; parasols are not counted. Grupo limits come from the custom subscription record.
- Landing, in-app cards, site create and site general read only catalogue values; the guard test passes; no "Starter", "Pro" or "Business" remains in visible text; the Grupo card shows no price and offers a quote request.
- A partner on a legacy tier is handled as decided under open question 3 and nothing breaks for existing sites or open payments.
- An admin can give a partner Temporada at 0% until a date; it expires without action.
- Existing negotiated site and account fees still win in `resolveServiceFee`.
- Test: run the repo's unit and integration test suites for `packages/data` and `apps/partner` (TEST database only), plus a manual pass: create a partner, walk through each plan's cards and gated settings, make a test-mode online booking on Temporada.

### Out of scope
Guest-paid fees; per-sunbed billing; any change to VAT or invoice numbering; Verifactu; marketing copy outside the app (landing and plan cards are in scope); the price of Grupo contracts (quote only, handled outside the app); changing production data (migrations and the legacy-partner mapping run through the normal release flow).

### Open questions for you (decide, or stop and report back before building)
1. **Stripe Connect and the cap.** `application_fee_amount` is computed per charge. Can a running monthly cap be applied at charge time without double counting under concurrent payments, or does it need a ledger table (site, month, commission taken) with a lock? How are Mollie and Viva fees handled the same way? Does anything need to be invoiced or credited after the fact instead (a month-end true-up)?
2. **Prisma enum migration.** `SubscriptionTier` is an enum used by `SubscriptionPlan`, `ServiceFee.subscriptionTier` and the code. What is the safest migration (add values, move rows, drop old values later) given `main` and `test` share a database and deployed code may still write the old values for one release?
3. **Existing partner accounts on the old tiers.** How many partners hold Starter, Pro or Business subscriptions or tier-specific fee rows today, including paying Stripe subscriptions? Propose a mapping (for example Starter to Gratis, Pro and Business to Temporada) that never raises anyone's cost without notice, and say what happens to a paid monthly Stripe subscription. If any partner has a real paid subscription, stop and report before migrating.
4. **Venues over the limit.** What should happen to a site that already has more than 100 hamacas on Gratis, or more than 300 on Temporada: grandfather it, or block saves until it upgrades?
5. **Granting the 2027 launch offer per partner.** Which mechanism (time-limited account-level fee at 0%, a dated promotion, a custom subscription note) is the least invasive and visible in the admin partner page? How is expiry handled, and what happens to billing when it expires?
6. **Gratis and off-platform mode.** Is the existing "unpaid" site type the right way to express "guests pay on site only", or does Gratis need its own flag? Does any guest flow (tabs, table deposits, rentals) still reach a card payment for a Gratis site?
7. **Hamaca count.** Is counting `InventoryItem` rows of sunbed and balinese-bed categories per site correct, and where do paired or grouped units (`SunbedGroup`) change the count?

### Report back
The branch and commits, the migration plan and what it did to existing partners, your answers to the open questions, any place where the code contradicted this prompt, and anything in the product that still shows the old plan names or a guest fee.
