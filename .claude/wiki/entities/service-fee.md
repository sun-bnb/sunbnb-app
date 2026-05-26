---
type: entity
slug: service-fee
status: stable
sources:
  - packages/data/prisma/schema.prisma#model-ServiceFee
  - packages/data/prisma/schema.prisma#model-Settings
  - packages/data/src/payment.ts#resolveServiceFee
  - packages/data/src/payment.ts#calculateServiceFeeAmount
  - packages/data/src/payment.ts#loadFeeContext
  - .claude/rules/payments.md
related:
  - entity:reservation
  - entity:order
  - entity:invoice
  - entity:settlement
last_verified: 2026-05-26
---

# Service Fee

The platform commission charged on each reservation, order, and rental. Configured (not hardcoded) and resolved via a three-tier cascade.

## Schema essentials

`Settings` — global platform configuration. `country?`, `currency?`, `vat?`. Has many `ServiceFee`.

`ServiceFee`:
- `settingsId` (required FK → Settings).
- `siteId?` (FK → Site) — per-site override.
- `accountId?` (FK → PartnerAccount) — per-partner override.
- `chargeType` — `"fixed"` or `"percentage"`.
- `feeAmount?` (Float) — used when `chargeType === "fixed"`.
- `percentage?` (Float) — multiplier, e.g. `0.10` for 10%; used when `chargeType === "percentage"`.
- `serviceCode` — `"sunbed-rental"` or `"food-and-beverage"` (also rental-related codes).

## Three-tier cascade

Resolution order (first match wins) — implemented in `resolveServiceFee`:

```
1. site fees       — ServiceFee where siteId = <this site>, accountId = NULL
2. account fees    — ServiceFee where accountId = <this partner>, siteId = NULL
3. settings fees   — ServiceFee where settingsId = <default settings>, both nulls
```

For each tier, the lookup is filtered by `serviceCode`. The first matching fee at the first non-empty tier is used.

`loadFeeContext(siteId, serviceCode)` is the canonical loader. It also bootstraps a default `Settings` row if none exists.

## Fee calculation

`calculateServiceFeeAmount(fee, referenceAmount)`:

```
if fee.chargeType === 'fixed'      → return fee.feeAmount
if fee.chargeType === 'percentage' → return round(fee.percentage × referenceAmount)
```

`referenceAmount` is the gross (VAT-inclusive) price.

## Where it's applied

The fee is the platform's **commission**, applied identically in every context (sunbed reservation, F&B order, rental, no-show deposit). The consumer pays the listed price; the partner is booked **gross** (the PARTNER invoice carries that full price); and the commission is a **separate B2B `PLATFORM` invoice billed to the partner** (recipient = partner, product code `"sunbnb-service-fee"`, reverse-charged at 0 VAT for cross-border EU B2B). The commission reduces the partner's **net payout**, not their booked revenue — it is collected via Mollie's `applicationFee` routing and is never added to the consumer total. See `[[entity:invoice]]` for line composition.

## Invariants

1. **Never hardcode a fee.** Configure via `ServiceFee` rows.
2. **Resolution is first-match-wins per tier.** Don't sum across tiers. Don't take the lowest. First match.
3. **`serviceCode` is required for resolution.** Without it the cascade returns nothing — and downstream code must handle "no fee" cleanly (zero fee).
4. **A fee row should have exactly one of `feeAmount` / `percentage` set** (whichever matches `chargeType`). The schema does not enforce this — application code must.
5. **Fees are recomputed at payment confirmation, not at booking creation.** This means a fee change between booking and payment uses the *new* fee. Acceptable in current product behaviour; revisit if business rules change.

## Configuration (admin app)

`apps/admin` manages fees via `app/fees/actions.ts`:
- CRUD on `ServiceFee` at all three tiers
- CRUD on `ServiceCode` (the list of allowed codes)
- Search sites/accounts to attach fees to specific entities

## Related entities

- `[[entity:invoice]]` — fees become invoice lines on partner and platform invoices.
- `[[entity:reservation]]`, `[[entity:order]]` — different directions of application.
- `[[entity:settlement]]` — aggregates fee amounts into the platform's monthly take.

## Common pitfalls

- **Treating the fee as part of the consumer payment, or as reducing booked revenue.** It's a separate B2B commission billed to the partner: the partner books gross, and the fee reduces their *net payout*. Don't net it into the PARTNER invoice or add it to the consumer total.
- **Assuming the cascade is union.** It is **first-match-wins per tier**. A site fee fully shadows the account-tier and settings-tier fees for that `serviceCode`.
- **Forgetting to recompute on price changes.** Fee math depends on `referenceAmount` — a price update to a sunbed/product after booking doesn't retroactively change the booked reservation's amount, but a price update before payment confirmation does affect the fee.
- **Setting both `feeAmount` and `percentage` on the same row.** Admin app currently allows it (known issue per `apps/admin/CLAUDE.md`). Don't.
- **Negative `feeAmount` or `percentage > 1.0`.** Admin app does not bound-check (known issue). Don't.
