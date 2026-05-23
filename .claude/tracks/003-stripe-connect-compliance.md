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

- The Stripe reservation PaymentIntent (`apps/user/app/api/payment/stripe/payment-intent/route.ts`)
  is a **plain charge into the platform's own Stripe account** — `paymentIntents.create({ amount,
  currency, automatic_payment_methods })` with **no `transfer_data` / `application_fee_amount` /
  `on_behalf_of` / connected `stripeAccount`**. The F&B **order** Stripe flow
  (`apps/user/app/api/order-payment/stripe/payment-intent/route.ts`) almost certainly mirrors it —
  confirm.
- **No Stripe Connect anywhere** in the payment code, and `PartnerAccount` has Stripe fields only for
  *subscriptions* (`stripeCustomerId` / `stripeSubscriptionId` — platform→partner billing, which is
  correctly platform-as-merchant). There is **no Stripe connected-account id** on the partner.
- Net: today, Stripe consumer reservation (and likely order) payments are collected by the platform —
  the exact thing the legal requirement prohibits. Mollie is compliant; Stripe is not.

## Severity

Live compliance exposure on any venue using Stripe (not demo/Mollie) for consumer reservations/orders.
Confirm with the founder/legal how urgent remediation is and whether Stripe consumer payments should
be **disabled** until Connect lands.

## Roadmap

- ☐ **Confirm scope.** Verify the order Stripe flow has the same gap; inventory every Stripe consumer
  charge path (reservations, orders, table deposits-to-be). Subscriptions are out of scope (platform
  is the correct merchant there).
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

## Links

- Driver: [[track:002-table-reservations]] (1e deposit collection — Mollie-only until Connect exists).
- Subsystem: [[subsystem:payments]] (Stripe vs Mollie; the wiki page needs the Connect model added).
