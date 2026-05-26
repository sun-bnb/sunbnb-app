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
  - packages/data/src/payment.ts#computeInvoiceHash
related:
  - entity:reservation
  - entity:order
  - entity:service-fee
  - entity:settlement
  - flow:reservation-payment
  - flow:order-payment
  - subsystem:payments
last_verified: 2026-05-26
---

# Invoice

Financial record of a confirmed payment. Two invoices per payment: one for the **partner** (revenue) and one for the **platform** (commission).

## Schema essentials

`Invoice`:
- `id`, `accountId` (FK → PartnerAccount), `status` (default `"created"`), `paymentRef?`, `invoicedAt`.
- Money: `totalCharge` (net), `totalTax`, `totalAmount` (gross).
- 1:1 → `Reservation` (via `Reservation.invoiceId`), 1:1 → `Order`.

`InvoiceLine`:
- `invoiceId`, `charge` (net), `tax`, `amount` (gross), `description?`, `productCode?`.

### Product codes used

- `"sunbed-rental"` — per-sunbed lines on a reservation invoice
- `"food-and-beverage"` — per-item lines on an order invoice
- `"sunbnb-service-fee"` — the platform commission line

### Two-invoice rule

For each successful payment, two `Invoice` rows are created (agent/marketplace model):

- **PARTNER invoice** — the partner's gross consumer sale (partner = merchant of record). Booked **GROSS**: lines carry the full price the consumer paid — one `sunbed-rental` line per sunbed (reservation), one `food-and-beverage` line per item (order), one line per booking (rental). The service fee is **not** netted out of these lines.
- **PLATFORM invoice** — the platform's **B2B commission billed to the partner**. `issuerType: PLATFORM`; the recipient fields (`recipientCompanyName/recipientVatNumber/recipientCompanyAddress`) are the partner. One `sunbnb-service-fee` line. Local VAT, or `reverseCharge` (0 VAT, partner self-accounts) for cross-border EU B2B.

The two invoices do **not** sum to the consumer payment — the PARTNER invoice alone equals it; the commission is collected via Mollie `applicationFee` and reduces the partner's net payout. `Invoice.processingFee` (VAT-exempt Mollie/PSP fee) is reserved for reconciliation. Canonical: `packages/data/src/payment.ts` (the `processConfirmed*` functions).

## Invariants

1. **Creation is idempotent.** `processConfirmedReservation` (and siblings) check for an existing `invoiceId` before creating; the transaction double-checks inside.
2. **All money math goes through `round()`** from `@repo/data`. Two decimals, always.
3. **Reverse VAT.** Prices are VAT-inclusive at source. `computeVatAndBaseAmounts(gross, vatRate)` does the canonical split: `base = round(gross / (1 + vatRate / 100))`, `vat = round(gross − base)`.
4. **Sequential numbering per issuer type.** Protected by `FOR UPDATE` row lock in the transaction to prevent gaps under concurrency.
5. **SHA-256 hash chain.** Each invoice includes a hash that incorporates the previous invoice's hash (per issuer type). Tamper-evident.
6. **Fee handling is uniform across reservation / order / rental / deposit.** The partner is booked gross; the fee is a separate B2B commission billed to the partner — never netted into the PARTNER invoice, never added to the consumer total. See `[[entity:service-fee]]`.
7. **`paymentRef` is the same** on both invoices and on the source Reservation/Order — the canonical correlation id.

## Hash chain

`computeInvoiceHash(number, date, amount, vatNumber, previousHash)` — SHA-256 of the concatenation. The previous-hash chain provides cheap integrity checking for the invoice register. If you ever need to insert/edit a historical invoice, the chain breaks; the project's policy is to *never* edit issued invoices — issue a correction instead.

## Related entities

- `[[entity:reservation]]` — source of the partner invoice for sunbed bookings (1:1).
- `[[entity:order]]` — source of the partner invoice for F&B (1:1).
- `[[entity:service-fee]]` — determines the commission line(s).
- `[[entity:settlement]]` — aggregates partner invoices monthly.

## Related flows

- `[[flow:reservation-payment]]` — when reservation invoices are created.
- `[[flow:order-payment]]` — when order invoices are created.

## Common pitfalls

- **Reading the partner invoice and thinking that's all there is.** Always two invoices per payment.
- **Calling `processConfirmed*` more than once and assuming the second call is no-op.** It *is* no-op when the existing-invoice check passes — but if you bypassed that check (don't), you'd duplicate.
- **Computing fee math in app code.** Don't. Use `packages/data/src/payment.ts` helpers.
- **Editing an issued invoice.** Breaks the hash chain. Always issue a correction (a new invoice + a credit invoice).
- **Assuming PARTNER + PLATFORM sum to the consumer payment.** They don't — the PARTNER invoice alone equals it; the PLATFORM invoice is a separate B2B commission billed to the partner.
- **Float comparison in tests.** Use `toBeCloseTo(expected, 2)` for money assertions.
