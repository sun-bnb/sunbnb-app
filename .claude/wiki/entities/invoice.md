---
type: entity
slug: invoice
status: stable
sources:
  - packages/data/prisma/schema.prisma#model-Invoice
  - packages/data/prisma/schema.prisma#model-InvoiceLine
  - packages/data/src/payment.ts#processConfirmedReservation
  - packages/data/src/payment.ts#processConfirmedOrder
  - packages/data/src/payment.ts#processConfirmedRentalBooking
  - packages/data/src/invoice-series.ts#allocateInvoiceIdentity
  - packages/data/src/invoice-series.ts#computeInvoiceHash
  - packages/data/src/payment-math.ts#computeVatAndBaseAmounts
related:
  - entity:reservation
  - entity:order
  - entity:service-fee
  - flow:reservation-payment
  - flow:order-payment
  - subsystem:payments
last_verified: 2026-10-13
---

# Invoice

Financial record of a confirmed payment. Two invoices per payment: one for the **partner** (gross consumer sale) and one for the **platform** (B2B commission billed to the partner).

## Schema essentials

`Invoice`:
- `id`, `accountId` (FK → `PartnerAccount.userId`; on a PLATFORM row this is the *recipient*), `status` (default `"created"`), `invoicedAt`, `issuerType` (`PARTNER` | `PLATFORM`), `product` (`beachclub` | `restaurant`).
- Money: `totalCharge` (net), `totalTax`, `totalAmount` (gross), `processingFee?` (VAT-exempt PSP pass-through).
- Source links (N:1 — a source has several invoices: PARTNER, PLATFORM, credit notes): `reservationId?`, `orderId?`, `tableReservationId?` (no-show deposit), `tableTabId?` (dine-in tab). Rentals have no FK — they link by `paymentRef` (`cash-rental-<id>` for cash walk-ins).
- Numbering & chain: `invoiceNumber` (unique), `seriesKey`, `seriesCode`, `seriesYear`, `seriesSeq`, `previousHash`, `hash`, `hashVersion`, `tipoFactura`; `verifactuRecords[]`.
- Credit notes: `creditsInvoiceId` → the original receipt (negative totals, `R` series, same issuer chain).

`InvoiceLine`: `invoiceId`, `charge` (net), `tax`, `amount` (gross), `vatRate?`, `description?`, `productCode?`.

### Product codes used

- PARTNER lines: `sunbed-rental` (per sunbed), `food-and-beverage` (per order item), `equipment-rental` (per rental booking), `no-show-deposit` (table deposit), `cash-refund-credit` (credit note).
- PLATFORM lines: `sunbnb-service-fee` (the commission), `payment-processing` (Stripe pass-through, VAT 0).

### Two-invoice rule

For each successful payment, two `Invoice` rows are created (agent/marketplace model — canonical in `.claude/rules/payments.md`):

- **PARTNER invoice** — the partner's gross consumer sale (partner = merchant of record). Lines carry the full price the consumer paid; the service fee is **not** netted out.
- **PLATFORM invoice** — `issuerType: PLATFORM`, issuer = the platform business entity, recipient fields (`recipientCompanyName/VatNumber/CompanyAddress`) = the partner. One `sunbnb-service-fee` line, plus a `payment-processing` line + `processingFee` when the payment is on the Stripe rail (`platformPassThroughFor`). Local VAT, or `reverseCharge` (0 VAT) for cross-border EU B2B. Skipped when the chargeable fee and pass-through are both 0 (e.g. launch-promotion waiver, `chargeableServiceFee`).

The two do **not** sum to the consumer payment — the PARTNER invoice alone equals it; the commission is collected by the provider (Mollie `applicationFee`, Stripe `application_fee_amount`) and reduces the partner's payout. Provider mechanics: `[[subsystem:payments]]`.

## Invariants

1. **Creation is idempotent and serialised per issuer.** Each `processConfirmed*` checks for existing invoices, then inside the transaction takes `lockInvoiceSeries(tx, seriesKey)` *before* re-checking — so a concurrent second caller waits and returns cleanly instead of duplicating.
2. **All money math goes through `round()`** (`packages/data/src/payment-math.ts`). Two decimals, always.
3. **Reverse VAT.** Prices are VAT-inclusive. `computeVatAndBaseAmounts(gross, vatRate)`: `base = round(gross / (1 + vatRate / 100))`, `vat = round(gross − base)`. PSP processing fees are never reverse-VATed.
4. **Per-issuer numbering.** `allocateInvoiceIdentity` keys the series on `seriesKey` (`PartnerAccount.userId`, or `PLATFORM`), counter row `InvoiceSeries` under a transaction-scoped advisory lock; `seriesCode` `F` (factura) / `R` (rectificativa) each dense per issuer-year; the year comes from `invoicedAt`, never the clock. Rendered `PREFIX-F-YYYY-NNNNN`.
5. **Per-issuer SHA-256 hash chain.** `computeInvoiceHash` covers `seriesKey`, number, `invoicedAt`, amount, issuer VAT id and `previousHash`; the chain head is stored in `InvoiceChain`, not searched. `verifyInvoiceChain(seriesKey)` re-walks it.
6. **Fee handling is uniform across reservation / order / rental / deposit / tab.** Partner booked gross; fee is a separate B2B commission — never netted into PARTNER, never added to the consumer total. See `[[entity:service-fee]]`.
7. **Invoices are immutable.** Refunds/corrections issue a credit note (`issueCashCreditNote`, `creditsInvoiceId`), never an edit or delete.

## Related entities

- `[[entity:reservation]]`, `[[entity:order]]`, `[[entity:table-reservation]]` — sources of PARTNER invoices.
- `[[entity:service-fee]]` — determines the commission line.

## Related flows

- `[[flow:reservation-payment]]`, `[[flow:order-payment]]`, `[[flow:rental-booking]]` — when invoices are created.

## Common pitfalls

- **Reading the partner invoice and thinking that's all there is.** Always two invoices per paid payment (PLATFORM may be absent only when nothing is chargeable).
- **Assuming a 1:1 source link.** `reservation.invoices` / `order.invoices` are arrays; filter by `issuerType` (and exclude credit notes) when you mean "the receipt".
- **Computing fee or VAT math in app code.** Use the `@repo/data` helpers.
- **Writing an invoice outside `allocateInvoiceIdentity`, or committing without the row.** The counter and chain head have already moved — a commit without the invoice leaves a permanent numbering gap.
- **Editing an issued invoice.** Breaks the hash chain and the Veri*factu record; issue a credit note.
- **Assuming PARTNER + PLATFORM sum to the consumer payment.** They don't.
- **Float comparison in tests.** Use `toBeCloseTo(expected, 2)` for money assertions.
