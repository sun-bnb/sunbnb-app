---
type: flow
slug: rental-booking
status: stable
sources:
  - packages/data/prisma/schema.prisma#model-RentalItem
  - packages/data/prisma/schema.prisma#model-RentalBooking
  - apps/user/app/sites/[id]/actions.ts#saveRentalBooking
  - apps/partner/app/sites/[id]/rentals/actions.ts
  - apps/partner/app/sites/[id]/manage/actions.ts#markRentalPickedUp
  - apps/partner/app/sites/[id]/manage/actions.ts#markRentalReturned
  - apps/partner/app/sites/[id]/manage/actions.ts#createWalkInRental
  - packages/data/src/payment.ts#processConfirmedRentalBooking
  - packages/data/src/reservation-status.ts
related:
  - entity:reservation
  - entity:invoice
  - entity:service-fee
  - flow:reservation-payment
  - flow:walk-in
last_verified: 2026-05-26
---

# Flow: Rental Booking

Equipment rental (surfboards, paddleboards, kayaks, etc.) — hourly or daily. Distinct from sunbed reservations in that rentals have **quantity**, **duration type**, and operational lifecycle `reserved → picked-up → returned`.

## Pre-conditions

- Site has `"rentals"` in its `features[]` array (toggle via `apps/partner/app/sites/[id]/rentals/actions.ts#toggleSiteFeature`).
- At least one `RentalItem` exists for the site with at least one of `pricePerHour` / `pricePerDay` set.
- User authenticated (anonymous flow exists for partner-side walk-in rentals via the manage page).

## Trigger paths

| Path | Where |
|---|---|
| Consumer self-serve | `apps/user/app/sites/[id]` → switch to equipment tab → select item + duration |
| Walk-in (partner on-site) | `apps/partner/app/sites/[id]/manage` → "Create Walk-in Rental" |

## Sequence — Consumer self-serve

1. **Availability check** — `apps/user/app/sites/[id]/actions.ts#saveRentalBooking`
   - Sum the `quantity` of existing `RentalBooking` rows that:
     - Match `rentalItemId`
     - Overlap the requested `from`/`to` window (`existing.from < requested.to AND existing.to > requested.from`)
     - Are NOT in `returned` / `canceled` operational status
   - Reject if `sum + requested.quantity > rentalItem.totalQuantity`
2. **Create booking** — `RentalBooking` insert with:
   - `durationType` (`"hours"` or `"days"`)
   - `quantity` (default 1)
   - `totalPrice` calculated server-side from `pricePerHour × hours` or `pricePerDay × days` × `quantity`
   - `status: pending`, `operationalStatus: reserved`
3. **Payment** — follows the same Mollie / Demo paths as `[[flow:reservation-payment]]`
   - On confirmation → `processConfirmedRentalBooking(paymentRef)` — note: groups bookings by `paymentRef` (a single payment can cover multiple booking rows)
4. **Invoice** — same as reservations: PARTNER invoice booked gross (full price), and a separate PLATFORM commission invoice billed to the partner.

## Sequence — Walk-in rental (partner)

1. **Partner opens manage page** — `/sites/[id]/manage` with `accessKey` token
2. **Create walk-in rental** — `apps/partner/app/sites/[id]/manage/actions.ts#createWalkInRental`
   - Token-gated (validates `SecurityToken` row, expiry, and `resources` includes `'all'` or `'manage_site'`)
   - Quick-pick duration: 1h, 2h, 3h, all day
   - Availability checked the same way as consumer path
   - Creates `RentalBooking` directly (no payment intent — assumed paid in cash on-site or settled separately)

## Operational lifecycle (after creation)

```
reserved → picked-up → returned
```

Transitions:
- `markRentalPickedUp` — partner records the customer picked up the equipment (`pickedUpAt` set)
- `markRentalReturned` — partner records return (`returnedAt` set; booking becomes terminal)

Overdue indicator: hourly bookings past their `to` time without being marked returned show as overdue in `RentalBookingCard`.

## Side effects

- DB writes: `RentalBooking` (insert + status updates), `Invoice` (×2 on confirmation), `InvoiceLine` (multiple).
- Email: confirmation per `reservation-emails.ts` — verify rental-specific template exists before claiming.

## Failure modes

| Failure | Detection | Recovery |
|---|---|---|
| Overlap conflict on insert | Availability re-check fails | `{ status: 'error', errors: [...] }` |
| Site lacks `"rentals"` feature | Action rejects | Partner must enable via `toggleSiteFeature` |
| RentalItem missing price for selected duration type | Action rejects | UI should not have offered the option |

## Related

- `[[entity:reservation]]` — sibling entity (sunbed bookings)
- `[[entity:invoice]]` — invoices created on confirmation
- `[[entity:service-fee]]` — fees apply
- `[[flow:reservation-payment]]` — payment paths are shared (Mollie/Demo)
- `[[flow:walk-in]]` — manage page lifecycle (sunbed side)

## Common pitfalls

- **Availability check that ignores `quantity`.** Rentals are quantity-bearing — must sum, not just count overlaps.
- **Status field collisions with sunbed reservations.** Different operational statuses: `reserved/picked-up/returned`, not `expected/checked-in/departed`. Use `OP_*` constants from `reservation-status.ts`.
- **Hours vs days price mismatch.** `RentalItem` may have only one of `pricePerHour`/`pricePerDay` set. Match the booking's `durationType`.
- **Walk-in rentals bypassing availability.** They don't — the action runs the same check.
- **Treating `returned` as a payment status.** It's operational. Payment status remains `complete` (or whatever it was).
