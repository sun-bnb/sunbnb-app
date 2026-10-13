---
type: flow
slug: rental-booking
status: stable
sources:
  - packages/data/prisma/schema.prisma#model-RentalItem
  - packages/data/prisma/schema.prisma#model-RentalBooking
  - apps/user/app/sites/[id]/actions.ts#saveRentalBooking
  - packages/data/src/reservations.ts#createRentalBookingsWithGuard
  - apps/user/app/api/payment/mollie/create-rental-payment/route.ts
  - packages/data/src/payment.ts#processConfirmedRentalBooking
  - apps/partner/app/sites/[id]/manage/actions.ts
  - apps/partner/app/sites/[id]/rentals/actions.ts
related:
  - entity:reservation
  - entity:invoice
  - entity:service-fee
  - flow:reservation-payment
  - flow:walk-in
last_verified: 2026-10-13
---

# Flow: Rental Booking

Equipment rental (surfboards, paddleboards, kayaks, etc.) — hourly or daily. Distinct from sunbed reservations in that rentals have **quantity**, **duration type**, and operational lifecycle `reserved → picked-up → returned`.

## Pre-conditions

- Site has `"rentals"` in its `features[]` (partner toggles via `apps/partner/app/sites/[id]/rentals/actions.ts#toggleSiteFeature`; the consumer UI gates on it — `saveRentalBooking` itself does not re-check).
- At least one `active` `RentalItem` for the site with `pricePerHour` and/or `pricePerDay`.
- Consumer: session user, or `anonId` (booking `userId` = site owner to satisfy the FK).

## Trigger paths

| Path | Where |
|---|---|
| Consumer self-serve | `apps/user/app/sites/[id]` → equipment tab → cart of items + duration |
| Walk-in (partner on-site) | `apps/partner/app/sites/[id]/manage` → "Create Walk-in Rental" |

## Sequence — Consumer self-serve

1. **Create bookings** — `apps/user/app/sites/[id]/actions.ts#saveRentalBooking`
   - Validates ids, `durationType` (`hours` | `days`), quantities, `from < to`
   - Loads `RentalItem`s scoped to the site with `active: true`; prices from DB: `pricePerHour × ceil(hours) × qty` or `pricePerDay × days × qty` (falls back to whichever price exists)
   - `status`: `pending` when the site's `rentalPaymentType ?? type` is `paid`, else `complete` (off-platform billing); `operationalStatus: reserved`; `paymentAmount = totalPrice`
   - **Availability + create in one transaction** — `createRentalBookingsWithGuard` (`packages/data/src/reservations.ts`): `SELECT … FOR UPDATE` on the RentalItem rows, then per booking sums overlapping `quantity` (`from < to' AND to > from'`, excluding `operationalStatus` `returned` / `canceled`) against `totalQuantity`; all-or-nothing.
2. **Payment** (paid sites) — one payment covers all booking rows (shared `paymentRef`):
   - Mollie: `apps/user/app/api/payment/mollie/create-rental-payment/route.ts` → `createRentalBookingMolliePayment` (`packages/data/src/rental-payment.ts`)
   - Stripe Connect / Viva: `/api/payment/create` with `kind: 'rental'` → `createOnlineCheckout`
   - Demo: `initiateDemoRentalPayment`
   - Provider and fee mechanics: `[[subsystem:payments]]`
3. **Verify / webhook** — `apps/user/app/api/rental-bookings/[id]/route.ts` polls `getPaymentStatus`; webhooks route `rental-booking` events via `_lib/payment-events.ts`.
4. **Invoice** — `processConfirmedRentalBooking(paymentRef)`: idempotent on `paymentRef` (invoices carry it — rentals have no Invoice FK); PARTNER invoice with one `equipment-rental` line per booking (gross), PLATFORM commission via `serviceFeeForUnits` (fixed fee per booking line). Fires `sendRentalConfirmationEmail` (`packages/data/src/rental-emails.ts`) for the first booking.

## Sequence — Walk-in rental (partner)

1. **Manage page** — `/sites/[id]/manage` (session owner, or `accessKey` token)
2. **Create walk-in rental** — `apps/partner/app/sites/[id]/manage/actions.ts#createWalkInRental`
   - `verifySiteOwnership(siteId, accessKey)`; ≤ 20 items, qty 1–100, hours 1–24 or venue-anchored days
   - `paymentType`: `cash` → `status: paid-in-cash`; `free` → `complete` (amount 0)
   - Same `createRentalBookingsWithGuard` availability + create
   - Genuine cash (`recordCashSettlement`): a `TillEntry` per booking + PARTNER-only receipt via `processCashRentalBooking` (keyed `cash-rental-<bookingId>`, non-blocking)
   - Card on the spot: bookings created as `paid-in-cash`, then `collectRentalPayment` (QR / terminal); invoiced by `processConfirmedRentalBooking` when the provider settles — no till entry at create (would double-count)

## Operational lifecycle (after creation)

```
reserved → picked-up → returned
```

- `markRentalPickedUp` — requires `reserved`; sets `picked-up`, `pickedUpAt`
- `markRentalReturned` — requires `picked-up`; sets `returned`, `returnedAt` (frees quantity)

Overdue indicator: hourly bookings past `to` and not returned show as overdue in the manage UI.

## Side effects

- DB writes: `RentalBooking` rows, `Invoice` (PARTNER + PLATFORM online; PARTNER-only cash), `InvoiceLine`, `TillEntry` (cash walk-in).
- Email: rental confirmation on online confirmation; due reminders via `sendRentalDueReminders`.

## Failure modes

| Failure | Detection | Recovery |
|---|---|---|
| Quantity exhausted | Guard returns `outcome: 'unavailable'` | `{ status: 'error', errors: ['Not enough "<item>" available…'] }` |
| Inactive / foreign `RentalItem` | Lookup count mismatch | `'Some items are not available'` |
| Cash receipt fails | Logged, non-blocking | Sale stands; re-run `processCashRentalBooking` (idempotent) |

## Related

- `[[entity:reservation]]` — sibling entity (sunbed bookings)
- `[[entity:invoice]]` — invoices created on confirmation
- `[[entity:service-fee]]` — fees apply
- `[[flow:reservation-payment]]` — payment paths are shared (Mollie / Stripe Connect / Viva / demo)
- `[[flow:walk-in]]` — manage page lifecycle (sunbed side)

## Common pitfalls

- **Availability check that ignores `quantity`, or runs outside the guard.** Rentals are quantity-bearing — sum inside `createRentalBookingsWithGuard`'s locked transaction.
- **Status field collisions with sunbed reservations.** Different operational statuses: `reserved/picked-up/returned`, not `expected/checked-in/departed`. Use `OP_*` constants from `reservation-status.ts`.
- **Hours vs days price mismatch.** `RentalItem` may have only one of `pricePerHour`/`pricePerDay` set. Match the booking's `durationType`.
- **Looking for a rental's invoice by FK.** There is none; match `Invoice.paymentRef` (online ref, or `cash-rental-<bookingId>`).
- **Treating `returned` as a payment status.** It's operational. Payment status remains `complete` / `paid-in-cash`.
