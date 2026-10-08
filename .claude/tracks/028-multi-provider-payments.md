---
id: 028-multi-provider-payments
title: Multi-provider payments — Mollie, Viva and Stripe as pluggable rails per partner
status: active
created: 2026-10-07
updated: 2026-10-08
worktree: null
---

## Goal

Make the consumer payment rail **pluggable per partner**: a venue connects one or more of
**Mollie**, **Viva** and **Stripe** (all three have a platform/partner programme and online
checkout), and the guest pays through a rail that venue has connected. Today Mollie is the only
real consumer rail (plus demo) and is hard-wired through checkout, webhooks, reconciliation and
invoicing.

**Invariants that do not change** (`.claude/rules/payments.md`): the guest pays the listed price
only; each payment yields a GROSS PARTNER invoice + a separate B2B PLATFORM commission invoice;
PSP processing fees are VAT-exempt and reconcile via `Invoice.processingFee`; invoice creation
stays idempotent. Only the *rail* becomes swappable — the invoicing core does not fork per
provider.

**Premise corrected at kickoff (2026-10-07).** "Card payment is only available with Viva" is not
right. All three take **online** card payments. For **card-present**: Mollie Tap to Pay is not in
Spain (track 024); Viva hands off to the separate Viva.com Terminal app (no embeddable SDK,
confirmed 2026-08-28); Stripe Terminal / Tap to Pay *does* ship an embeddable SDK incl. React
Native — **Spain availability unverified**.

**Choice model (working assumption, confirm with founder).** The *partner* chooses providers
(connect = onboarding with that PSP; money settles into the venue's connected account). The
*guest* chooses a payment *method* (card, Apple Pay, Bizum, iDEAL…), not a PSP.

## Resume here

- **State (2026-10-08):** **P1–P6 shipped — committed and pushed to `main` 2026-10-08** (`41c09f7..116f696`, 9 commits;
  migration `20261007162101_add_payment_provider_selection` applied to local, `sunbnb_test` and the
  Neon TEST DB; NOT production — `./deploy-to-production.sh` migrates it). The one unverified leg is
  **the physical tap of Stripe Tap to Pay**: dev build, pairing, chooser, server leg (token, ES
  Location, card_present PI) and simulated reader connect were verified in the iOS Simulator
  2026-10-08, but the iOS SDK cancels `collectPaymentMethod` there (log entry below) — needs a real
  iPhone (Apple entitlement) or an NFC Android phone.
- **Next action, in order:** (1) deployed-env config: Vercel env vars per app (see list below) and
  the two Stripe Connect webhook endpoints; (2) founder decisions still open: PLATFORM credit note
  on refunded online payments, Verifactu treatment of the 0%-VAT `payment-processing` line;
  (3) physical-device Tap to Pay tap; (4) Viva http mode once KYC clears (edit only
  `vivaOnlineHttp`). Commission rounding: DONE 2026-10-08 (`serviceFeeForUnits`). Commit + push +
  `migrate:test`: DONE 2026-10-08. Production gets the migration via `./deploy-to-production.sh`
  (founder runs it).
- **Env vars per environment** (local `.env.local` + Vercel test/preview + production, per app):
  - user: `STRIPE_CONNECT_SECRET_KEY`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `VIVA_MODE`,
    `VIVA_CHECKOUT_SOURCE_CODE`, `VIVA_CHECKOUT_COLOR`, `VIVA_WEBHOOK_VERIFICATION_KEY`
    (+ existing `CRON_SECRET`, now also guarding the `*/15` reconcile cron).
  - partner: `STRIPE_CONNECT_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_CONNECT_PUBLIC_KEY`,
    `STRIPE_CONNECT_ACCOUNT_WEBHOOK_SECRET`, `VIVA_MODE` (+ Viva ISV vars when http).
  - Restricted Connect key scopes: Accounts/Account sessions, Checkout Sessions **write**,
    PaymentIntents write, Refunds write, Charges read, Terminal connection tokens/locations write,
    readers read. Gap: `VIVA_WEBHOOK_VERIFICATION_KEY` is not in `turbo.json` `globalEnv` and the
    `VIVA_CHECKOUT_*` / `VIVA_WEBHOOK_*` vars are not in `dev-env.example` — add before deploy.
- **Stripe dashboard config for each deployed env** (Connect webhooks, "events on connected
  accounts"): user `https://<host>/api/webhooks/stripe-connect` — `checkout.session.completed`,
  `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
  `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`,
  `payment_intent.canceled`, `charge.refunded`; partner `https://<host>/api/stripe-connect/webhook` —
  `account.updated`, `capability.updated`. Each endpoint's signing secret → the matching env var.
  Live mode needs its own platform setup (test = **Sunbnb Test** `acct_1QME0B…`).
- **Viva dashboard config (when KYC clears):** payment source success/fail URL
  `https://<user-host>/api/payment/viva/return`; webhook `https://<user-host>/api/webhooks/viva`
  (events 1796 payment created, 1797 reversal, 1798 failed; GET handshake returns
  `VIVA_WEBHOOK_VERIFICATION_KEY`). Then confirm the ISV field names inside `vivaOnlineHttp`.
- **Open founder decisions:** (a) **commission rounding** — invoice sums per item, charge-time fee
  is on the total (≤1c/item, Mollie too): one shared helper vs invoice-on-total; (b) **refunded
  online payment leaves the PLATFORM commission invoice standing** — credit note? (D5); (c)
  **Verifactu categorisation of the 0%-VAT `payment-processing` PLATFORM line** (accountant);
  (d) **Apple Tap to Pay on iPhone entitlement** (`com.apple.developer.proximity-reader.payment.acceptance`)
  — request from Apple, then add to `app.json` `expo.ios.entitlements` (simulated reader needs none).
- **Decided 2026-10-07 (founder):** D1 **multi-provider** (one *selected* provider per
  `PartnerAccount`, `Site.paymentProvider` = *effective*, synced to all sites); D2 partner picks the
  provider, guest picks the method; D3 one provider per account; **ref prefix only, no `Payment`
  ledger**; **select-then-connect**; Stripe = Connect with **own-form API onboarding** +
  **embedded components**, direct charges; Stripe processing fee **passed through** in
  `application_fee_amount` and booked on the PLATFORM invoice; card-present = Viva Cloud Terminal
  **plus Stripe Tap to Pay in `apps/mobile`**. Viva online is **stub-only** until KYC clears.
- **Do not:** reintroduce consumer Stripe as a platform-collecting charge ([[track:003]]); move or
  remove `/api/webhooks/mollie` (in-flight payments have it baked in — keep forever as a wrapper);
  edit applied migrations; fork invoicing per provider; edit Mollie routes beyond import swaps and
  the pure handler move; write reservation status outside the single-writer allowlist.

## Roadmap

### Key finding: the invoicing core is already neutral

`processConfirmed*` (`packages/data/src/payment.ts:617/1060/1484/2161`) take an entity id / opaque
`paymentRef` — no provider branch needed. Coupling lives in **create, confirm (webhook/poll/reconcile),
refund, and partner connect**. Also found: `Invoice.processingFee` is **never written** (only read by
`fiscal.ts:241`) — fee capture was never built; and admin `sites/actions.ts:30` still accepts
`'stripe'` as a site provider (drift from [[track:003]]).

### Mollie hard-wiring inventory (Plan pass, 2026-10-07)

| Surface | Where |
|---|---|
| Create | `packages/data/src/reservation-payment.ts:92`, `rental-payment.ts:99`; user routes `api/order-payment/mollie/create-payment`, `api/tab-payment/mollie/create-payment`, `api/payment/mollie/create-rental-payment` (duplicates `rental-payment.ts`), `api/table-reservations/[id]/deposit/mollie` |
| Client UI → Mollie URLs | `apps/user/app/payment/Payment.tsx:103`, `OrderPayment.tsx:94`, `sites/[id]/Reservation.tsx:570`, `tables/[tableId]/view.tsx:479`, `sites/[id]/table/view.tsx:200` (`paymentProvider` prop passed but ignored) |
| Webhook | `apps/user/app/api/webhooks/mollie/route.ts` — `tr_` regex `:207`, domain handlers `:94-201` are provider-neutral logic trapped in the route |
| Status/reconcile | `apps/user/app/api/_lib/payment-provider.ts` (no Viva branch; data-layer copy at `reservation-payment.ts:265` has one), `_lib/mollie.ts:68` (5-table scan), `:26` dead `MOLLIE_API_KEY` client; `api/reconcile/route.ts` sweeps only reservations + orders (**rentals, tabs, deposits never swept — existing gap**) |
| Refunds | `packages/data/src/refund.ts:24-49`, duplicate in `user/_lib/payment-provider.ts:58`, `partner/_lib/mollie.ts:509` |
| State machine | `reservation-machine.ts:222-224` effects `mollieCreate/Cancel/Refund`; `reservation-machine-apply.ts` (single-writer guard test) |
| `tr_` prefix in clients | `floor-core/src/bulk.ts:112`, partner `manage/BedDetail.tsx:327`, `apps/mobile/src/components/BedDetail.tsx:90`, `packages/data/src/promotion.ts:59` |
| `isDemoPayment` | 6 copies (user `_lib/payment-ids.ts:11`, `refund.ts`, `reservation-payment.ts`, `rental-payment.ts`, `reservation-machine-apply.ts`, partner `_lib/mollie.ts`) |
| Partner connect | `packages/data/src/mollie-tokens.ts`, partner `api/mollie/*`, `auth.ts` scopes, `account/mollie/*`, readiness/onboarding/sidebar/banner; `site-actions.ts:332-361` `setPaymentProvider` mollie-only |
| Discovery gate | `apps/user/service/siteService.ts:127-135` SQL requires Mollie token + onboarding |
| Mocks | `apps/{user,partner}/__mocks__/@repo/data/{reservation-payment,rental-payment,refund,payment,PrismaCient}.ts` |

### Proposed shape

- `@repo/data/payment-refs` — **pure**, client-safe ref helpers (replaces prefix checks + demo copies).
- `@repo/data/payment-providers/types` (pure) + `@repo/data/payment-providers` (server registry):
  `OnlinePaymentProvider { id; connectionStatus; createCheckout; parseWebhook; fetchStatus;
  cancel?; refund; fetchFees? }`, one state vocabulary `pending|paid|failed|refunded`.
- `@repo/data/payment-events` — `onPaymentState(meta, ref, state)`: the single dispatcher, lifted
  out of the Mollie webhook; called by every webhook, poll route and reconcile.
- **`Payment` ledger table** (ref unique, provider, partnerAccountId, providerAccountId, entity,
  amount, applicationFee, processingFee, status) — provider is **frozen at create**; refunds,
  webhooks, reconcile follow the row, never the site's current setting. Prefix inference only as
  fallback for legacy rows. Entity `paymentRef` columns untouched.
- Selection per **Site** (`Site.paymentProvider` exists), validated against connected providers.
- **Card-present stays a separate `CardPresentProvider`** (Viva Cloud Terminal = server push;
  Stripe Terminal would be client SDK — different shape, don't force-fit).

### Ref scheme (decided 2026-10-07 — the single discriminator, no ledger)

`tr_` Mollie · `pi_demo_` demo · `viva_<sessionId>` Viva Cloud Terminal (card-present, live,
untouched) · `vso_<orderCode>` Viva Smart Checkout · `stripe_cs_<cs_…>` Stripe Checkout Session ·
`stripe_pi_<pi_…>` Stripe Tap to Pay PaymentIntent. Namespaced wrappers avoid the bare-`pi_` vs
`pi_demo_` order dependence. Owner: `@repo/data/payment-refs` (pure).

### Phases (approved plan 2026-10-07 — full detail in the plan file)

| | Status | Scope | Schema | Done when |
|---|---|---|---|---|
| **P1** refs + abstraction + dispatcher | ✅ | `payment-refs`; lift Mollie webhook handlers into user `_lib/payment-events.ts` (`onPaymentState`); `payment-provider.ts`/`refund.ts`/`reservation-payment.ts` branch by `providerFromRef`; `@repo/data/checkout` + `payment-providers/{types,index}` adapter scaffold; neutral `POST /api/payment/create` (non-Mollie only; Mollie routes byte-identical); reconcile sweeps all five kinds + `CRON_SECRET`; replace the 6 demo copies + 4 `tr_` client checks; mocks | none | all suites green, Mollie webhook's 34 tests untouched, prefix grep residue = `payment-refs.ts` + webhook regex |
| **P2** schema + readiness + hub | ✅ | ONE additive migration (`PartnerAccount.paymentProvider` selected + `stripeConnect*`, `Site.stripeTerminalLocationId`); pure `payment-providers/{availability,readiness}`; `selection.ts syncEffectiveProvider`; `/account/payments` hub (select-then-connect, banner while selected ≠ effective); five readiness consumers centralised; provider-aware discovery SQL; admin allowlist | `<ts>_add_payment_provider_selection` — `migrate:test` before pushing main | migration on local + `sunbnb_test` + test DB; `migrate:check` clean; nothing outside `/account/mollie` reads `mollieOnboardingStatus` |
| **P3** Stripe Connect | ✅ | `@repo/data/stripe/{client,connect,checkout,terminal}` (SDK moves to data); own-form onboarding wizard `/account/stripe` (Accounts API) + embedded `account_management/payouts/balances/notification_banner`; direct-charge Checkout Session + `application_fee_amount` (= commission + processing estimate, `fee-policy.ts`); PLATFORM invoice gets a VAT-exempt `payment-processing` line + `processingFee`; Connect webhooks (user: payments; partner: `account.updated`); refunds with `refund_application_fee` | none (P2 columns) | every charge on `acct_…`; five kinds confirm via webhook AND poll; Mollie suites untouched |
| **P4** Viva Smart Checkout | ✅ (stub) | `viva/checkout-{types,http,stub}` behind `VIVA_MODE`; every unverified ISV field inside one `vivaOnlineHttp` builder; `/api/payment/viva/return?t=&s=`; unsigned `/api/webhooks/viva` (always re-fetch) | none | stub end-to-end for five kinds; `viva_` card-present untouched |
| **P5** Stripe Tap to Pay (mobile) | ◐ (all but the physical tap verified) | machine rows `tapToPay` + effects `stripeTerminalIntent/Cancel`; `runCollectStartTapToPay`; RPC `createTapToPayIntent` + `getStripeConnectionToken`; `@stripe/stripe-terminal-react-native` dev build, simulated reader; `CollectPaymentModal` "Tap to Pay · On this phone" | none (P2 column) | simulated tap settles through `pay.confirm`; allowlist ⊆ gated registry |
| **P6** docs/tracks/wiki | ✅ | this file, 024, index, four `CLAUDE.md`s, `rules/payments.md`, wiki ingest | — | docs match the shipped code |

## Log

- **2026-10-07** — Track created. Premise corrected (online card on all three; card-present
  differs). Plan pass launched to map Mollie hard-wiring and propose the provider abstraction.
- **2026-10-07** — Plan pass done (read-only). Invoicing core already neutral; coupling is in
  create/confirm/refund/connect. Recommended a `Payment` ledger table over prefix inference, a
  single `onPaymentState` dispatcher, card-present kept as a separate interface. Spot-checked:
  `Invoice.processingFee` has no writer; admin `sites/actions.ts:30` accepts `'stripe'`; discovery
  SQL `siteService.ts:127` hard-requires Mollie. Roadmap P1–P4 written.
- **2026-10-07** — Second planning round (three Explore maps + a Plan pass + Stripe/Viva doc
  research). Founder decided D1–D3, the ref model (prefix only), select-then-connect, the Stripe
  model (own-form API onboarding = `requirement_collection='application'`, embedded components
  for management, direct charges), fee pass-through, and widened scope to **Stripe Tap to Pay in
  `apps/mobile`** (ES verified in Stripe docs). Verified from this machine: Stripe CLI logged in
  to the test account, `.env.local` keys are test keys → Stripe test-mode E2E is runnable
  unattended; Viva online stays stub-only (KYC pending, developer.viva.com unreachable for the ISV
  field names). Found: `PaymentProcessingFee` table is read by no code; `fiscal.ts:241` sums
  `processingFee` over PARTNER invoices only. Roadmap rewritten as P1–P6; P1a delegated.
- **2026-10-07** — **P1 shipped (uncommitted).** `@repo/data/payment-refs` (prefix vocabulary);
  every private `tr_`/`pi_demo_` check in data, floor-core, partner, mobile, user now imports it
  (grep residue: none). `refund.ts`/`reservation-payment.ts`/`rental-payment.ts` branch on
  `providerFromRef` (viva-terminal refunds now dispatched; new ids return "not wired"). New
  `@repo/data/checkout` (`resolveCheckoutIntent`/`createOnlineCheckout`, fees copied from the
  Mollie paths, reservation/rental writes via new sanctioned `mark*Checkout*` writers) +
  `payment-providers/{types,index}` adapter scaffold (throws `ProviderNotWiredError`). User:
  Mollie webhook handlers lifted verbatim into `_lib/payment-events.ts` (`onPaymentState`,
  `findPaymentEntity`) — **Mollie webhook 34/34 with zero test edits**; neutral
  `POST /api/payment/create` (provider resolved server-side; Mollie venues → 400; 503 until
  adapters land); reconcile = five sweeps, GET+POST, `CRON_SECRET`, `*/15` Vercel cron, rentals
  paid-only (only webhook/poll know a QR-collect revert). Behaviour notes: Mollie ref matching is
  now the strict webhook regex everywhere; `cancelReservationMolliePayment` returns "Unknown
  payment provider" for an unrecognised non-null ref instead of trying Mollie. Gates: data
  1013 unit + 584 integration, floor-core 68, user 852 unit + 111 integration, partner 2135 +
  245 integration, admin 239, tsc/lint clean everywhere, mobile `expo export` OK. Browser
  (`/verifier-sunbnb`, demo): site drawer → Reserve as guest → Pay now → reservation PAID,
  PARTNER €14 + PLATFORM €0.22 invoices in DB (rows cleaned up).
- **2026-10-07 — FOUND (pre-existing, NOT 028, unfixed): the short seat-QR page cannot book.**
  `apps/user/app/q/resolve.ts` loads the unit's items without `site` (the legacy
  `sites/[id]/pos/[itemId]/queries.ts` includes `site: true`), and the POS Reserve button sends
  `items[0].site.id` → `saveReservationForMultipleItems` returns "Invalid site ID". Every site
  with a `code` redirects its legacy seat page to `/q/…`, so a printed lounger QR card can't
  reserve. One-line fix (`include: { site: true }` on the items, or pass `site.id`); flagged to
  the founder rather than fixed inside this track.
- **2026-10-07** — **P2 shipped (uncommitted).** Migration `20261007162101_add_payment_provider_selection`
  (additive: `PartnerAccount.payment_provider` + 8 `stripe_connect_*` cols + unique index,
  `Site.stripe_terminal_location_id`) on local + `sunbnb_test` (NOT the Neon test DB yet). Pure
  `payment-providers/availability` (country matrix) + `readiness` (`providerReadiness`,
  `effectiveProviderFor`); `selection.ts syncEffectiveProvider`, called from every Mollie/Viva
  connection-state write. Partner `/account/payments` hub + `selectPaymentProvider`; five readiness
  consumers → `providerReadiness` (`PaymentsBanner`, sites list, checklist, site payload
  `paymentReadiness`/`cardPresent`, General-tab provider card; `CardTerminalsCard` only for
  `terminal-app`); `setPaymentProvider` retired to a pointer. User discovery SQL keyed on the
  site's effective provider (9 integration cases). Admin override allowlist mollie/viva/stripe
  gated on readiness (Mollie now also needs `completed`). Browser: ES account sees the three cards
  with "Mollie Tap to Pay is not available in Spain"; selecting Stripe persisted and synced both
  sites (restored after). Gotcha logged in `knowledge/data-dev.md`: `migrate dev` can't run
  non-interactively on a unique-index warning — use `migrate diff --script` + deploy.
- **2026-10-07** — **P3a (data) shipped.** `stripe` ^20.4 moved into `@repo/data/stripe`
  (client/connect/checkout); own-form onboarding helpers with `CONNECT_CONTROLLER`
  (`requirement_collection:'application'` …), `snapshotFromAccount`/`snapshotToColumns`,
  `createAccountSession` (account_management/payouts/payments/balances/notification_banner);
  direct-charge Checkout Session (`{stripeAccount}`, `application_fee_amount`); `fee-policy.ts`
  (`commission-plus-processing`, estimate 1.5% + €0.25); PLATFORM invoice gets a VAT-exempt
  `payment-processing` line + `processingFee` for Stripe refs — **including table deposits**
  (they do have a PLATFORM invoice); Stripe adapter + status/cancel/refund branches. Data 1136
  unit + 595 integration. Open check: Verifactu categorisation of a 0%-VAT PLATFORM line.
- **2026-10-07** — **P3 + P4 shipped and verified (uncommitted).** Stripe platform account =
  **Sunbnb Test** (`acct_1QME0B…`, same account as subscriptions; Connect enabled by the founder
  2026-10-07). Env: `STRIPE_CONNECT_SECRET_KEY` (restricted key needs Accounts/Account sessions,
  **Checkout Sessions write**, PaymentIntents write, Refunds write, Charges read, Terminal conn
  tokens/locations write, readers read — Checkout write was the missing one), partner
  `NEXT_PUBLIC_STRIPE_CONNECT_PUBLIC_KEY`, `STRIPE_CONNECT_WEBHOOK_SECRET` (user) +
  `STRIPE_CONNECT_ACCOUNT_WEBHOOK_SECRET` (partner). Live probe found ES requirements the plan
  missed (nationality, phone, owners + `company.owners_provided`, rep title) → added. **Browser
  E2E on Stripe test mode:** own-form wizard (individual, ES, Stripe test identity) → account
  `complete`, charges+payouts on; embedded Account Management renders the account; hub select
  → sites effective=stripe; drawer → Pay now → hosted Checkout ON THE CONNECTED ACCOUNT → 4242 →
  `/payment/complete` → PAID; DB: PARTNER €14 gross + PLATFORM €0.22 commission + €0.46 VAT-exempt
  `payment-processing` line (`processingFee` 0.46); both Connect webhooks 200 via `stripe listen
  --forward-connect-to`; refund via `issueReservationRefund` → €14 refunded on `acct_…`,
  application fee reversed, `charge.refunded` webhook → reservation `refunded`. **Viva stub E2E:**
  `/account/viva` stub connect → verified → hub select Viva → drawer → stub checkout → Pay →
  return route → PAID; PARTNER €14 + PLATFORM €0.22 (no pass-through — correct). Bug found+fixed:
  the Viva checkout stub store must live on `globalThis` (Next dev splits API routes and RSC pages
  into separate module graphs).
- **2026-10-07 — FOUND (pre-existing, Mollie too, unfixed): charge-time commission ≠ invoiced
  commission for multi-item bookings.** `processConfirmedReservation` (`payment.ts:~693`) sums
  `calculateServiceFeeAmount` PER ITEM (2 × round(1.5% × €7) = €0.22) while the charge-time fee
  (`reservation-payment.ts:~149` Mollie `applicationFee`, and `checkout.ts commissionFor`) is
  computed on the TOTAL (1.5% × €14 = €0.21). Stripe test run: collected application fee 67c vs
  PLATFORM invoice €0.68. Up to 1 cent per item. Needs a founder call: one shared helper for both
  sides (changes Mollie `applicationFee` by ≤1c/item) vs invoice-on-total. Also open: a refunded
  online payment leaves the PLATFORM commission invoice standing (no credit note) — same as Mollie
  today (D5).
- **2026-10-08** — **P5 shipped (uncommitted).** Data: machine condition `tapToPay` + effects
  `stripeTerminalIntent` / `stripeTerminalCancel` (`runCollectStartTapToPay`; abandon reverifies
  once and never reverts a possibly-captured tap), `@repo/data/stripe/terminal`
  (`ensureTerminalLocation` → `Site.stripeTerminalLocationId`, connection token, card_present
  PaymentIntent on the connected account with commission + pass-through). Partner:
  `collectReservationPayment(…, {method:'tap-to-pay'})` gated on effective `stripe` +
  `cardPresent: 'tap-to-pay'`, `getStripeConnectionToken`, both in the manage RPC registry (allowlist
  ⊆ gated registry); `/api/manage/context` returns `paymentProvider` + `cardPresent`. Mobile:
  `@stripe/stripe-terminal-react-native` (dev build only; no-op provider elsewhere),
  `src/lib/{tap-to-pay.tsx,site-context.ts}`, `CollectPaymentModal` "Tap to Pay · On this phone",
  simulated reader by default in `__DEV__`. Simulator run 2026-10-08: see the P5 Simulator entry.
- **2026-10-08** — **P6 docs done.** Root / partner / data `CLAUDE.md` (mobile + user were updated
  inside their packets), `rules/payments.md` (re-fetch-before-acting webhooks, ref-prefix rule,
  direct charges only, pass-through constant), 024 cross-link, registry row, wiki ingest
  (`subsystems/payments.md` provider matrix, `flows/reservation-payment.md` step-3 branch). Found
  while documenting: `VIVA_WEBHOOK_VERIFICATION_KEY` missing from `turbo.json` `globalEnv`;
  `VIVA_CHECKOUT_*` missing from `dev-env.example`.

- **2026-10-08** — **P5 Simulator run (iPhone 17 Pro, Xcode 26.6, dev build).** CocoaPods
  installed (brew) and Maestro 2.11 installed to `~/.maestro` (release zip, no rc edits; brew's
  formula refuses Xcode 26.6) with founder approval. Native build of
  `@stripe/stripe-terminal-react-native@0.0.1-beta.33` on Expo 57 / RN 0.86 **succeeds**. Maestro
  drove: pair (`siteId:key`) → grid → walk-in "Card" → chooser shows **"Tap to Pay · On this
  phone"** (native module + provider/cardPresent gating proven) → server leg works (connection
  token, Terminal Location, card_present PaymentIntent with application fee on the connected
  account, €14.00 due) → simulated tapToPay reader **connects** and reaches `waitingForInput` →
  **the iOS SDK cancels `collectPaymentMethod` itself (`CANCELED`, error 2020) — our `cancel()`
  is provably not called**, also with a simulated location + location permission granted. The
  app then abandons correctly: reservation back to unsettled cash, all 5 PaymentIntents
  `canceled` on Stripe. Conclusion: the final tap leg can't complete in the iOS Simulator;
  verify on a physical iPhone (needs Apple's Tap to Pay entitlement) or an NFC Android phone.
  Bugs found + fixed: (1) **ES Terminal Locations require `address.state`** → new pure
  `esProvinceFromPostalCode` (`tax/regime.ts`) + `terminalLocationState` (taxRegion first);
  (2) after an app reload the SDK auto-reconnects its reader while our ref is empty → re-discovery
  failed with 1110 → wrapper now adopts `connectedReader`; (3) the effect-failed path swallowed
  the Stripe error → now `console.error`ed server-side; the phone logs the SDK collect error.
  Gates after fixes: data 1183, partner 2213, mobile tsc/lint/expo export green.
- 2026-10-08 — **Commission parity fix.** Founder decision: fixed fees apply per unit (per bed / per
  rental booking line); percentage fees are computed once on the total paid. Bug: invoice side summed
  `calculateServiceFeeAmount` per item/booking (percentage rounded per item: 2 x round(1.5% x 7) = 0.22 vs
  charge 0.21; Stripe test run collected 67c vs PLATFORM invoice 0.68) while the charge side computed one
  fee on the total (fixed fee collected once for N beds). Fix: one pure `serviceFeeForUnits(fee, {total, units})`
  in `payment.ts`, used by `processConfirmedReservation`/`processConfirmedRentalBooking` and every charge path
  (`createReservationMolliePayment`, `createRentalBookingMolliePayment`, user `create-rental-payment` route,
  `checkout.ts commissionFor`, Viva card `runCollectStartCard`, `runCollectStartTapToPay`). Invariant pinned by
  `payment.commission-parity.integration.test.ts`.

## Open decisions

- **D1 — RESOLVED 2026-10-07: multi-provider.** One *selected* provider per `PartnerAccount`;
  `Site.paymentProvider` is the *effective* one (flips only when the selected provider is ready).
  024's single-provider end state is superseded — update 024 in P6.
- **D2 — RESOLVED: partner picks the provider, guest picks the method.**
- **D3 — RESOLVED: one provider per account** (all its sites), no routing.
- **Fee model — RESOLVED: Stripe processing fee passed through** in `application_fee_amount`
  (commission + estimate; `fee-policy.ts`, one constant) and booked as a VAT-exempt
  `payment-processing` line + `Invoice.processingFee` on the PLATFORM invoice. Accountant note:
  the VAT treatment of a re-billed PSP fee follows `.claude/rules/payments.md` (exempt) — confirm.
- **D4 — Commission settlement differs.** Mollie/Stripe route the fee per payment; Viva ISV fee
  arrives as a monthly credit → settlement needs a "commission receivable" state for Viva. PLATFORM
  invoice stays per transaction.
- **D5 — Refunds outside our UI** (Viva app, Stripe dashboard) bypass us → every adapter's webhook
  must handle `refunded`. Does a Stripe refund reverse the `application_fee`? PLATFORM credit note must match.
- **D6 — RESOLVED (founder's Stripe dashboard choice): controller model with own-form API
  onboarding** — `requirement_collection='application'`, `losses.payments='application'`,
  `fees.payer='application'`, `stripe_dashboard.type='none'`; embedded components for account
  management; **direct charges** so the connected account stays merchant of record for the
  payment ([[track:003]]). Consequence to hold: the platform carries negative balances/disputes
  and is billed Stripe's processing fee (hence the pass-through).
- **D7 — RESOLVED 2026-10-07: Stripe Tap to Pay is available in ES** (iPhone + Android, Stripe
  docs). Needs `@stripe/stripe-terminal-react-native` (dev build, not Expo Go) and Apple's
  `com.apple.developer.proximity-reader.payment.acceptance` entitlement for a real device
  (founder action; simulated readers need none).
- **Risk — ref collision:** CLOSED by the namespaced `stripe_cs_` / `stripe_pi_` wrappers — no
  prefix is a prefix of another.
- **Risk — Viva online marketplace split** is still unconfirmed ([[track:024]] Q2).

## Links

- [[track:024]] `024-card-present-payments.md` — Viva card-present rail, `viva_*` columns, `VivaTerminal`
- [[track:003]] `003-stripe-connect-compliance.md` — why consumer Stripe was removed; Connect green-field
- `.claude/rules/payments.md` · `.claude/wiki/subsystems/payments.md`
- `packages/data/src/payment.ts` — `processConfirmed*`
