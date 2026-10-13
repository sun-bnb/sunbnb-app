---
type: entity
slug: service-fee
status: stable
sources:
  - packages/data/prisma/schema.prisma#model-ServiceFee
  - packages/data/prisma/schema.prisma#model-Settings
  - packages/data/src/payment.ts#resolveServiceFee
  - packages/data/src/payment.ts#serviceFeeForUnits
  - packages/data/src/payment.ts#chargeableServiceFee
  - packages/data/src/payment.ts#loadFeeContext
  - .claude/rules/payments.md
related:
  - entity:reservation
  - entity:order
  - entity:invoice
last_verified: 2026-10-13
---

# Service Fee

The platform commission charged on each reservation, order, and rental. Configured (not hardcoded) and resolved via a three-tier cascade.

## Schema essentials

`Settings` — per-country platform configuration (`country?`, `currency?`, `vat?`). Has many `ServiceFee`. The fee context picks the row matching the site's country, falling back to the first row (`findCountryMatchedSettings`).

`ServiceFee`:
- `settingsId` (required FK → Settings).
- `siteId?` (FK → Site) — per-site override.
- `accountId?` (FK → PartnerAccount) — per-partner override.
- `subscriptionTier?` — on settings-tier rows, a plan-specific platform fee.
- `product?` — optional scope (`beachclub` | `restaurant`); NULL = any product.
- `chargeType` — `"fixed"` or `"percentage"`.
- `feeAmount?` (Float) — used when `chargeType === "fixed"`.
- `percentage?` (Float) — a **percent number** (`10` = 10%, divided by 100 in code); used when `chargeType === "percentage"`.
- `serviceCode` — e.g. `sunbed-rental`, `food-and-beverage`, `no-show-deposit`, rental codes; allowed codes live in `ServiceCode`.

## Three-tier cascade

Resolution order (first match wins) — `resolveServiceFee(siteFees, accountFees, settingsFees, serviceCode, tier)`:

```
1. site fees       — ServiceFee where siteId = <this site>
2. account fees    — ServiceFee where accountId = <this partner>
3. settings fees   — siteId = accountId = NULL; prefers subscriptionTier = <partner's plan tier>,
                     falls back to subscriptionTier = NULL
```

Each tier is filtered by `serviceCode`. `loadFeeContext(siteId, serviceCode)` is the canonical loader for charge/invoice paths — it bootstraps default `Settings` + a fee for the code if none resolve (transactional, idempotent). Read-only paths use `getSiteFeeContext` / `resolveSiteFees`. Restaurant and tab paths have siblings (`loadRestaurantFeeContext`, `loadTabFeeContext`).

## Fee calculation

- **`serviceFeeForUnits(fee, { total, units })` is THE commission rule** — used by every charge-time fee (Mollie `applicationFee`, Stripe `application_fee_amount`, Viva `isvAmount`) and every PLATFORM invoice, so collected === invoiced. Fixed → `feeAmount × units` (per bed / rental line); percentage → `percentage / 100 × total`, once on the gross total.
- `calculateServiceFeeAmount(fee, referenceAmount)` — the single-unit form (fixed → `feeAmount`; percentage → `percentage / 100 × referenceAmount`), used for orders and deposits.
- **`chargeableServiceFee(fee, partnerAccount, bookingCreatedAt)`** wraps the resolved fee: returns none while the partner's launch promotion covers that booking (track 027). Every charge point must pass the **booking's** `createdAt` so payment-creation and confirmation agree.

## Where it's applied

The fee is the platform's **commission**, applied identically in every context (sunbed reservation, F&B order, rental, no-show deposit, dine-in tab). The consumer pays the listed price; the partner is booked **gross**; the commission is a **separate B2B `PLATFORM` invoice billed to the partner** (product code `sunbnb-service-fee`, reverse-charged for cross-border EU B2B) and is collected by the provider's application fee, reducing the partner's **net payout**. Canonical: `.claude/rules/payments.md`; line composition: `[[entity:invoice]]`; provider mechanics: `[[subsystem:payments]]`.

## Invariants

1. **Never hardcode a fee.** Configure via `ServiceFee` rows.
2. **Resolution is first-match-wins per tier.** Don't sum across tiers or take the lowest.
3. **`serviceCode` is required for resolution.** Without a match the cascade returns `undefined` → fee 0, and the `> 0` guards skip the application fee and PLATFORM invoice.
4. **A fee row should have exactly one of `feeAmount` / `percentage` set** (matching `chargeType`). The schema does not enforce this.
5. **Resolved twice, from one rule.** The fee is computed at payment creation (application fee) and again at confirmation (PLATFORM invoice) — both via `chargeableServiceFee` + the same calculation, so they match unless the fee config changes in between.

## Configuration (admin app)

`apps/admin` manages fees via `app/fees/actions.ts`:
- CRUD on `ServiceFee` at all three tiers
- CRUD on `ServiceCode` (the list of allowed codes)
- Search sites/accounts to attach fees to specific entities

## Related entities

- `[[entity:invoice]]` — fees become invoice lines on partner and platform invoices.
- `[[entity:reservation]]`, `[[entity:order]]` — different directions of application.

## Common pitfalls

- **Treating the fee as part of the consumer payment, or as reducing booked revenue.** It's a separate B2B commission billed to the partner: the partner books gross, and the fee reduces their *net payout*. Don't net it into the PARTNER invoice or add it to the consumer total.
- **Assuming the cascade is union.** It is **first-match-wins per tier**. A site fee fully shadows the account-tier and settings-tier fees for that `serviceCode`.
- **Reading `percentage` as a fraction.** `10` means 10%; `0.10` would charge 0.1%.
- **Computing a fixed fee once per payment.** Fixed fees are per unit (bed / rental line) via `serviceFeeForUnits`.
- **Skipping `chargeableServiceFee`.** A charge point that resolves the fee directly ignores the launch-promotion waiver and diverges from the invoice.
- **Setting both `feeAmount` and `percentage` on the same row.** Admin app currently allows it (known issue per `apps/admin/CLAUDE.md`). Don't.
- **Negative `feeAmount` or `percentage > 100`.** Admin app does not bound-check (known issue). Don't.
