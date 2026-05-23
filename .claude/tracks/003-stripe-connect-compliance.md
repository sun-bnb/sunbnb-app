---
id: 003-stripe-connect-compliance
title: Stripe Connect / platform-collection compliance
status: active
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

## The gap (verified 2026-05-23)

- **Both** Stripe consumer charge paths are plain charges into the **platform's own Stripe account** —
  `paymentIntents.create({ amount, currency, automatic_payment_methods, metadata })` with **no
  `transfer_data` / `application_fee_amount` / `on_behalf_of` / connected `stripeAccount`**:
  - reservation: `apps/user/app/api/payment/stripe/payment-intent/route.ts:78`
  - F&B order: `apps/user/app/api/order-payment/stripe/payment-intent/route.ts:75` (confirmed — mirrors it)
- **No Stripe Connect anywhere** in the payment code, and `PartnerAccount` has Stripe fields only for
  *subscriptions* (`stripeCustomerId` / `stripeSubscriptionId` — platform→partner billing, which is
  correctly platform-as-merchant). There is **no Stripe connected-account id** on the partner.
- Net: today, Stripe consumer reservation + order payments are collected by the platform — the exact
  thing the legal requirement prohibits. Mollie is compliant; Stripe is not.

## Scope & urgency (confirmed 2026-05-23)

**In scope** — exactly two consumer charge paths (both `apps/user`): **reservations** + **F&B orders**.
**Out of scope:** **rentals** (Mollie-only — no Stripe path exists, `apps/user/app/api/payment/mollie/create-rental-payment`), table-reservation **deposits** (Mollie-only by decision — [[track:002-table-reservations]]), and **subscriptions** (platform-as-merchant is correct there).

**Urgency — the gap is one ungated toggle away.** Site default is `paymentProvider = "mollie"`
(`schema.prisma:234`) and switching a site to **Mollie requires a connected account**
(`mollieAccessToken`). But switching to **Stripe is ungated** — `setPaymentProvider`
(`apps/partner/app/sites/[id]/site-actions.ts:315`) just writes `paymentProvider: 'stripe'` with no
onboarding/check, after which reservation + order payments immediately collect into the platform's
shared Stripe account. So **any partner can self-serve into the non-compliant state with one click**,
and live exposure = however many production sites currently have `payment_provider = 'stripe'`.

**Founder action to size it:** `SELECT count(*) FROM site WHERE payment_provider = 'stripe';` on prod
(and test). If 0 → no live exposure yet, but the toggle should still be closed to prevent new
exposure. If > 0 → live exposure now; decide migrate-to-Mollie / notify.

**Recommended immediate containment (cheap, independent of building Connect):** gate `setPaymentProvider`
to reject `'stripe'` (and hide/disable the Stripe option in the partner General UI) until Connect
lands — converting an open self-serve toggle into "no new exposure" in a few lines. Sites already on
Stripe need a separate decision (migrate or pause Stripe charges).

## Roadmap

- ✅ **Confirm scope** (2026-05-23). Two consumer paths — reservation + order PaymentIntents — both
  plain platform charges (no Connect). Rentals (Mollie-only), table deposits (Mollie-only), and
  subscriptions (correctly platform-merchant) are out of scope. See Scope & urgency above.
- ☐ **Immediate containment (do first; cheap).** Gate `setPaymentProvider` to reject `'stripe'` +
  hide/disable the Stripe option in the partner General UI, so no new site can self-serve into
  platform-collecting Stripe. Founder: count prod sites already on `payment_provider='stripe'`; for
  any, decide migrate-to-Mollie / pause. This is the urgent bit; the rest is the proper Connect build.
- ☐ **Connected-account model.** Decide the Connect charge type (destination charges with
  `transfer_data`+`application_fee_amount`, vs direct charges on the connected account vs separate
  charges+transfers) and storage (a `stripeConnectedAccountId` on `PartnerAccount`, mirroring
  `mollieAccessToken`). Architecture pass — touches `packages/data` + the payment subsystem.
- ☐ **Onboarding.** Stripe Connect onboarding flow in the partner app (Account Links / hosted
  onboarding), mirroring the Mollie OAuth connect flow; gate consumer Stripe charges on a completed
  connected account.
- ☐ **Migrate consumer charges.** Reservation + order PaymentIntents → Connect (funds to the venue,
  `application_fee_amount` = platform commission). Update webhooks/reconcile for connected-account
  events.
- ☐ **Unblock table deposits + pre-auth.** Once Connect exists, enable Stripe for the 1e deposit flow
  ([[track:002-table-reservations]]); until then deposits are Mollie-only. This is also where the
  **fee-clean pre-auth / card-hold** deposit mechanic lands (authorize, capture only on no-show → no
  PSP fee on show-ups), replacing the interim Mollie "targeted upfront deposit + refund-on-arrival"
  which leaks a per-transaction fee on every refunded deposit. Stripe's manual capture supports this
  cleanly; Mollie's auth support is too limited to rely on.
- ☐ **Wiki.** Update `[[subsystem:payments]]` to document the connected-account model for Stripe
  (currently it only describes Mollie-for-Platforms + "direct" Stripe consumer payments).

## Log

- **2026-05-23** — Track created. Found while planning the table-reservation no-show **deposit
  collection** ([[track:002-table-reservations]] 1e Piece 2): the founder asked whether Stripe would
  use the same non-collecting/commission arrangement as Mollie (a legal requirement). Code check
  showed it does **not** — the Stripe reservation PaymentIntent collects into the platform account
  with no Connect. Recorded as a separate compliance track; 002 deposits go **Mollie-only** until this
  lands.
- **2026-05-23** — **Scope + urgency confirmed** (code investigation). Scope = exactly two consumer
  charge paths (reservation `payment/stripe/payment-intent:78` + order `order-payment/stripe/
  payment-intent:75`), both plain platform charges; rentals/deposits/subscriptions out of scope.
  Urgency = **one ungated toggle**: `setPaymentProvider('stripe')` (site-actions.ts:315) writes the
  flag with no onboarding (vs Mollie which requires a connected account), so any partner can self-serve
  into platform-collecting Stripe; live exposure = sites with `payment_provider='stripe'` (founder to
  count on prod). Added an **immediate-containment** roadmap step (gate the Stripe toggle) ahead of the
  full Connect build.

## Links

- Driver: [[track:002-table-reservations]] (1e deposit collection — Mollie-only until Connect exists).
- Subsystem: [[subsystem:payments]] (Stripe vs Mollie; the wiki page needs the Connect model added).
