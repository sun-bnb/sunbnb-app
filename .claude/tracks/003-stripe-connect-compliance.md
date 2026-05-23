---
id: 003-stripe-connect-compliance
title: Stripe Connect / platform-collection compliance
status: backlog
created: 2026-05-23
updated: 2026-05-23
worktree: null
---

## Goal

**The platform must not be the merchant of record for consumer payments — funds must flow to the
venue and the platform may only take a commission.** (Stated as a current **legal requirement** by
the founder, 2026-05-23.) Mollie already satisfies this via **Mollie-for-Platforms** (the venue's
connected `mollieAccessToken`, funds to the venue, platform takes `applicationFee`). **Stripe does
not** — see the gap below. The goal of this track is to bring Stripe consumer payments onto the same
connected-account/commission model (**Stripe Connect**), closing the compliance gap and unblocking
Stripe for the table-reservation no-show deposits ([[track:002-table-reservations]] 1e).

## The gap (verified 2026-05-23) — closed by removal 2026-05-23

> **Update (2026-05-23): the gap is closed by *deleting* the offending code, not by fixing it.** The
> consumer Stripe charge paths below were **purged** from `apps/user` (the stripe payment-intent +
> webhook routes, the Elements UI + `stripePublicKey` threading, `_lib/stripe.ts`), and the prod
> "stripe" sites — all our own test beaches, no real customers — were migrated to Mollie first.
> Consumer payment is now **Mollie + Demo only**, and `setPaymentProvider` rejects anything but
> `'mollie'` (`VALID_PAYMENT_PROVIDERS = { 'mollie' }`). So there is **no non-compliant consumer code
> in production**; this track is now **green-field** — the work below applies only *if/when* consumer
> Stripe is deliberately reintroduced, and then it must be built on Connect from the start.

The original gap, for the record (code since deleted):

- **Both** Stripe consumer charge paths were plain charges into the **platform's own Stripe account** —
  `paymentIntents.create({ amount, currency, automatic_payment_methods, metadata })` with **no
  `transfer_data` / `application_fee_amount` / `on_behalf_of` / connected `stripeAccount`**:
  - reservation: `apps/user/app/api/payment/stripe/payment-intent/route.ts:78`
  - F&B order: `apps/user/app/api/order-payment/stripe/payment-intent/route.ts:75` (confirmed — mirrored it)
- **No Stripe Connect anywhere** in the payment code, and `PartnerAccount` has Stripe fields only for
  *subscriptions* (`stripeCustomerId` / `stripeSubscriptionId` — platform→partner billing, which is
  correctly platform-as-merchant). There was **no Stripe connected-account id** on the partner.
- Net (at the time): Stripe consumer reservation + order payments were collected by the platform — the
  exact thing the legal requirement prohibits. That code is now removed; Mollie (compliant) is the only
  consumer path.

## Scope & urgency (confirmed 2026-05-23)

**In scope** — exactly two consumer charge paths (both `apps/user`): **reservations** + **F&B orders**.
**Out of scope:** **rentals** (Mollie-only — no Stripe path exists, `apps/user/app/api/payment/mollie/create-rental-payment`), table-reservation **deposits** (Mollie-only by decision — [[track:002-table-reservations]]), and **subscriptions** (platform-as-merchant is correct there).

**Urgency — LOW / latent, NOT a live exposure (corrected 2026-05-23 per founder + UI check).** Stripe
is **subscriptions-only** today (platform-as-merchant, which is correct). Stripe **in-app/consumer
payments are deferred and not exposed to any users**: the partner General UI's payment-provider
section shows **only Mollie** (`apps/partner/app/sites/[id]/general/view.tsx:760-774` — a fixed Mollie
card, no provider chooser), so there is **no product path to select Stripe**. `setPaymentProvider`
*accepts* `'stripe'` at the server-action level (`site-actions.ts:297,315`), but that's **dormant code
with no UI entry point** — not a self-serve toggle. So the Connect gap is latent: it would only become
live if/when Stripe in-app payments are deliberately enabled. (My earlier "one ungated toggle away"
was wrong — there's no UI toggle.)

**Therefore this track is deferred future work, not a fire.** When Stripe in-app payments are
eventually exposed, they must be built on Connect from the start (the body below). Until then: no
action required; optional defense-in-depth would be to also reject `'stripe'` in `setPaymentProvider`
so the dormant path can't be reached even via a direct action call.

**Visibility-gate context (founder, 2026-05-23):** end-user visibility of a beach/restaurant is gated
on *payment capability* — a venue is hidden when it has **neither off-platform payments enabled NOR a
working Mollie connection** (it can't take any payment → unusable for the guest). So the usable-payment
path is **off-platform-or-Mollie**; Stripe-consumer is not part of it, which is *why* the latent Stripe
gap touches no real users. (Worth verifying + folding into [[subsystem:payments]] — see roadmap.)

## Roadmap

- ✅ **Confirm scope** (2026-05-23). Two consumer paths — reservation + order PaymentIntents — both
  plain platform charges (no Connect). Rentals (Mollie-only), table deposits (Mollie-only), and
  subscriptions (correctly platform-merchant) are out of scope. See Scope & urgency above.
- ✅ **Containment done by removal** (2026-05-23). Went past defense-in-depth: the consumer Stripe code
  is **deleted**, and `setPaymentProvider` now rejects anything but `'mollie'`
  (`VALID_PAYMENT_PROVIDERS = { 'mollie' }`). The prod sanity check (`SELECT count(*) FROM site WHERE
  payment_provider = 'stripe'`) found 13 sites — all our own test beaches, no real customers — which
  were migrated to Mollie before the purge.
- ✅ **Verify + document the visibility gate** (2026-05-23). Verified in
  `apps/user/service/siteService.ts#searchSites` (the sole consumer site-discovery query → `/sites`
  SSR + `/api/sites`): a `Site` is listed only if **all services are off-platform** (`type` /
  `order_payment_type` / `rental_payment_type` all `IS DISTINCT FROM 'paid'`) **OR** the partner has
  **completed Mollie onboarding** (`mollieAccessToken` + `mollieOnboardingStatus = 'completed'`). The
  clause references **only Mollie** — confirming consumer Stripe is not on the payable/visible path.
  Documented in [[subsystem:payments]] ("Discovery visibility gate"). Restaurants have no separate
  consumer-discovery query yet (reached via their linked Site), so this gate governs them too.
- ☐ **Connected-account model.** Decide the Connect charge type (destination charges with
  `transfer_data`+`application_fee_amount`, vs direct charges on the connected account vs separate
  charges+transfers) and storage (a `stripeConnectedAccountId` on `PartnerAccount`, mirroring
  `mollieAccessToken`). Architecture pass — touches `packages/data` + the payment subsystem.
- ☐ **Onboarding.** Stripe Connect onboarding flow in the partner app (Account Links / hosted
  onboarding), mirroring the Mollie OAuth connect flow; gate consumer Stripe charges on a completed
  connected account.
- ☐ **Build consumer charges on Connect (green-field).** If consumer Stripe is reintroduced, build
  reservation + order charges on Connect from the start (funds to the venue, `application_fee_amount` =
  platform commission); wire webhooks/reconcile for connected-account events. (The old
  platform-collecting PaymentIntents were **deleted**, not migrated — there is nothing to retrofit.)
- ☐ **Unblock table deposits + pre-auth.** Once Connect exists, enable Stripe for the 1e deposit flow
  ([[track:002-table-reservations]]); until then deposits are Mollie-only. This is also where the
  **fee-clean pre-auth / card-hold** deposit mechanic lands (authorize, capture only on no-show → no
  PSP fee on show-ups), replacing the interim Mollie "targeted upfront deposit + refund-on-arrival"
  which leaks a per-transaction fee on every refunded deposit. Stripe's manual capture supports this
  cleanly; Mollie's auth support is too limited to rely on.
- ✅ **Wiki + docs reconciled to the removal** (2026-05-23). `[[subsystem:payments]]`, the
  reservation/order flow pages, root + `apps/user` `CLAUDE.md`, and incidental wiki mentions now read
  "consumer = Mollie + Demo; Stripe = subscriptions only". A *future* edit (when Connect lands) will
  add the connected-account model for consumer Stripe.

## Log

- **2026-05-23** — Track created. Found while planning the table-reservation no-show **deposit
  collection** ([[track:002-table-reservations]] 1e Piece 2): the founder asked whether Stripe would
  use the same non-collecting/commission arrangement as Mollie (a legal requirement). Code check
  showed it does **not** — the Stripe reservation PaymentIntent collects into the platform account
  with no Connect. Recorded as a separate compliance track; 002 deposits go **Mollie-only** until this
  lands.
- **2026-05-23** — **Scope confirmed** (code investigation). Scope = exactly two consumer charge paths
  (reservation `payment/stripe/payment-intent:78` + order `order-payment/stripe/payment-intent:75`),
  both plain platform charges; rentals/deposits/subscriptions out of scope.
- **2026-05-23** — **Urgency corrected DOWN to latent/low** (founder + UI check). Stripe is
  subscriptions-only today; Stripe **in-app payments are deferred and not exposed** — the partner
  General UI offers **only Mollie** (`general/view.tsx:760-774`), so `setPaymentProvider('stripe')` is
  dormant code with no UI entry point (my earlier "one ungated toggle away" was wrong). Not a live
  exposure → this track is **deferred future work**, not a fire. Also captured the founder's
  **visibility-gate** model (venue hidden unless off-platform-payments OR Mollie) which is *why* the
  latent gap touches no users. Containment downgraded to optional defense-in-depth; added a
  verify-and-document-the-visibility-gate step.
- **2026-05-23** — **Consumer Stripe purged; gap closed by removal.** Founder confirmed the 13 prod
  "stripe" sites were all our own test beaches (no real customers) and authorized migrating them to
  Mollie, then deleting the dead consumer Stripe code so it stops degrading agent context. Done:
  migrated the test-beach sites to Mollie; removed `_lib/stripe.ts`, the stripe payment-intent +
  webhook routes (reservation + order), and the Stripe Elements UI + `stripePublicKey` threading from
  `apps/user`; reworked `payment-provider` + `reconcile` to Mollie+demo (`PaymentProvider = 'mollie'`);
  `setPaymentProvider` + `VALID_PAYMENT_PROVIDERS` are Mollie-only; tests reworked (user 194 green).
  Reconciled docs + wiki to "consumer = Mollie + Demo, Stripe = subscriptions only". Stripe survives
  for partner subscriptions only. **This track is now green-field** (build-on-Connect-if-reintroduced),
  not remediation of live non-compliant code.

## Links

- Driver: [[track:002-table-reservations]] (1e deposit collection — Mollie-only until Connect exists).
- Subsystem: [[subsystem:payments]] (Stripe vs Mollie; the wiki page needs the Connect model added).
