# Patterns — User App (`apps/user`)

Pulled on demand; **not** auto-loaded. Narratives behind the one-line pointers in
`apps/user/CLAUDE.md`. Payment flows end to end: `.claude/wiki/flows/reservation-payment.md`,
`.claude/wiki/subsystems/payments.md`; state machine: `.claude/wiki/subsystems/reservation-state-machine.md`.

## QR entry routes (tracks 021, 022)

- **`/q/[site]`** — canonical venue QR (`/q/S-K7M2X9`), canonical form of `/sites/[id]/pos`.
  `Site.code` is the whole key: immutable (a slug rename would orphan every printed card) and 8
  chars vs a 25-char cuid. Validated (`isValidSiteCode`) BEFORE any query, then folded through
  `normalizeSiteCode` so a lowercase hand-typed URL resolves. Renders the same `PosView` via
  `sites/[id]/pos/queries.ts` `getPosSite`.
- **`/q/[site]/[unit]`** — canonical seat QR (`/q/S-K7M2X9/1-1-1`), printed on a lounger's card;
  80 → 35 chars, QR v5 (37×37) → v3 (29×29). Keyed by the unit ADDRESS, not a seat row: the card
  belongs to the **spot**, so a parcel rebuilt in place keeps working (a genuine rearrange can
  re-point one — the accepted trade, matching how a device resolves).
  - Resolution: `app/q/resolve.ts` `resolveQrTarget` — syntax checked pre-DB, code folded, unit by
    `unitAddressWhere` on `UNIQUE(site_id, parcel, row_idx, seq)`, `pool` spares excluded, seats
    ordered by `number`. Accepts the four-segment seat id `1-1-1-2` as the same unit.
  - Declines (never renders an empty unit) on unknown code, no unit at the address, or a unit of
    only spares. Availability from the SAME `posAvailability` tail as the legacy route.
- **Legacy `/sites/[id]/pos`** (id or slug) redirects to `/q/[site]` when the site has a code,
  preserving query params; else renders as before. Deliberate: between deploying track 022 and
  running `backfill:site-codes`, an unconditional redirect would send every card to nowhere.
- **Legacy `/sites/[id]/pos/[itemId]`** redirects to `/q/[site]/[unit]` when the site has a code AND
  the unit has an address; else renders as before (an environment without track 021's
  `parcel`/`row_idx` falls back per unit).

## Per-seat POS page (`/sites/[id]/pos/[itemId]`)

- Availability decided SERVER-side in `pos/[itemId]/queries.ts` `getPosContext` via the canonical
  `getAvailabilityForItems`; the page ships `availableItemIds` and the client never re-derives it.
  (Was a client rule over an unfiltered `reservations` include — canceled/refunded/payment_failed
  blocked a seat forever and "today" was browser-midnight; fixed 2026-08-16.)
- `getPosContext` excludes `pool` spares (`SEGMENT_SEATS`) — a spare parked on a unit is not a bed
  under that parasol and made the unit read "Reserved" forever.
- The unit is drawn as art (one bed, or two under a shared parasol), each seat's id above its bed,
  ordered by seat number so the picture is the same whichever bed's QR was scanned.
- With `partialGroupBookingEnabled` (unit of 2+ beds) each bed is tappable: a **towel** at 30° marks
  a bed in the booking; the unit opens with every FREE bed towelled; the price strip follows the
  pick; an empty pick disables RESERVE with no price. Rules: pure `pos-seat-selection.ts`.

## Partial group booking (`Site.partialGroupBookingEnabled`, partner General tab)

- Default: selection is unit-granular — a click takes or drops the whole SunbedGroup. Flag on: the
  FIRST click on an untouched unit takes the whole unit, every later click toggles ONE seat;
  emptying a unit returns it to untouched.
- One pure module — `app/sites/[id]/seat-selection.ts` `toggleSeatSelection` — shared by
  `SunbedSelection` (geo) and `SchematicSelection` so the canvases cannot drift. Flag read off the
  site payload (all Site scalars arrive via `include`). `/sites/[id]/pos` renders the same component.
- In both modes selection drops unit members that are NOT available (a unit can be partly booked;
  co-selecting a held seat earned a server rejection of the whole reservation). Same for on-open
  preselection: `app/sites/[id]/sunbed-preselection.ts` `pickRandomAvailablePair` (a random fully
  free pair, else a random unit trimmed to its free beds; the geo map pans to it).
- **Not enforced server-side**: `saveReservationForMultipleItems` books exactly the ids it is sent
  (never expanded units) — the flag is client-side policy until venue/POS flows land.

## The booking funnel is ONE component (track 023 P2)

- `components/booking/BookingSurface.tsx` owns the funnel: sticky sidebar at `lg`, fixed
  peek-and-expand drawer below it, scrim, minimise pill, on-mount bootstrap (`focused: true` + today
  as `reservationDay`, track 014), and the `ReservationView` mount. `SiteView` is the page AROUND it
  and mounts it once; branded `/s/[slug]` gets it through the same `SiteView`.
- **Custom brand pages mount this instead of copying the drawer** — a copy stops matching the day
  the payment step, seat-selection policy or drawer mechanics change.
- Contract `{ site, apiKey, theme?, openOnMount? }`. `openOnMount` (default true) is the track-014
  reserve-first auto-open; a brand whose hero IS the landing moment opts out (Alcúdia). Later openers
  (peeked date field `onOpen`, a CTA dispatching `focused: true`, tab switches) still work;
  `reservationDay` is committed on mount regardless. `theme` is deliberately NOT `SiteViewBrand` —
  the funnel only cares about the two colours.
- Coordinates via the `sites` slice (`focused`, `reservationDay`, `reservationMode`, `viewMode`),
  not callbacks. Peek arithmetic: pure `app/sites/[id]/peek-height.ts`.
- Mobile drawer: peek (minimized) and expanded states; peek height varies by tab — sunbeds shows the
  date range only, equipment shows the hours/days toggle + time picker; tab switch opens the drawer.

## Bespoke brand pages (track 023)

- `/s/[slug]` renders a per-site module from `brands/<key>/` when `resolveBrandRender`
  (`@repo/data/brand-manifest`) passes both gates: `Site.customBrandKey` naming a module in
  `BRAND_KEYS`, and `Site.customBrandEnabled`. Anything else renders the standard branded page — a
  missing/misconfigured bespoke page costs the customer their design, never their bookings.
- `brands/` sits outside `app/` so the router never walks it; a brand has full app access on purpose
  (reuse drawer, availability read, translations) and must mount `BookingSurface`.
- **Code splitting is measured, not assumed:** an awaited `() => import(…)` in a server component
  does NOT split, nor does `next/dynamic` from server code — only `dynamic()` behind the
  `brands/BrandMount.tsx` CLIENT boundary emits one chunk per brand. `brands/registry.test.ts`
  guards it with a source check; re-verify by rebuilding and grepping `.next/static/chunks` for a
  string unique to one brand.
- **A brand page is NOT in the server HTML** — `curl | grep` sees the standard page. Verify in a
  BROWSER (a grep cost a false "deployment is broken" diagnosis on test).
- Tailwind: `brands/` is inside the app, so v4 auto-detection already scans it (see
  `app/globals.css`); only shared packages need `@source`.

## Seat ids (track 021)

Every guest-facing seat (confirmation, reservation item, QR pass, receipt, branded reservations,
POS) uses `formatSeatId` (`@repo/data/seat-label`) → `{parcel}-{row}-{seq}-{member}` (`1-1-1-2`). It
UNPACKS the stored `seatLabel` (middle segment packs row + unit ordinal, `1-101-2`); nothing stored
changed, so devices resolve the same spot. Receipts/passes render live, so OLD reservations show the
new form too.

## Reservation state transitions (track 018)

Webhook/poll/reconcile failure reverts, demo initiation and user cancel/delete delegate to
`applyTransition` (`@repo/data/reservation-machine-apply`). `pay.fail` resolves collect-vs-online
BY STATE (`metadata.collect` not load-bearing); `user.delete` rejects PROCESSING bookings (in-flight
payment could orphan); `user.cancel` runs the provider refund via a caller-supplied handler BEFORE
the status write. Single-writer ratchet: `packages/data/src/reservation-machine-guard.test.ts`.

## Payment route details not in the wiki

- **`POST /api/payment/create`** (track 028) — neutral dispatcher for NON-Mollie providers. Body
  `{ kind: reservation|order|rental|tab|table-deposit, <ids>, anonId?, redirectUrl }`. Provider
  resolved SERVER-SIDE (`Site.paymentProvider`; tab/deposit: linked site, else the restaurant's
  `PartnerAccount.paymentProvider`, else `mollie`) — never from the body; a Mollie venue gets 400
  "Use the Mollie endpoint". Ownership mirrors the Mollie routes (deposit also needs the
  `restaurants` flag); a tab is a QR credential claimed via `claimTabForPayment`, released on every
  bail-out. Delegates to `createOnlineCheckout` (`@repo/data/checkout`). Errors: `invalid_amount`→400,
  `not_found`→404, `bad_state`→409, `provider_not_ready`→400, `provider_unavailable`→503,
  `provider_error`/`no_checkout`→502.
- **`GET /api/payment/viva/return?t=<txId>&s=<orderCode>`** — validates, resolves the entity via
  `vso_<s>`, best-effort confirms a matching paid transaction, then 302s to the kind's return page
  (reservation `/payment/complete`, rental `/payment/complete/rental`, order `/reservations/<id>` or
  `/payment/complete`, tab `/tables/<id>?tabReturn=`, deposit `/table-reservations/<id>`); unknown →
  `/?payment=unknown`.
- **`/payment/viva/stub`** — dev-only fake checkout (`VIVA_MODE=stub`, else 404); Pay/Fail actions
  flip the in-process stub state (on `globalThis`) then redirect to the return route.
- **`/api/reconcile`** — `viva-terminal` refs are never swept (the floor flow confirms); demo refs are
  skipped on the newer sweeps. Rentals are **paid-only**: a failed/expired rental is left to the
  webhook and the `/api/rental-bookings/[id]` poll, since only they know whether it was a partner QR
  collect (revert to paid-in-cash) or an online failure (`payment_failed`).
- **Demo tab payment** (`initiateDemoTabPayment`) — on a `processConfirmedTabPayment` error it does
  NOT revert; the poll route retries.

## Dine-in tabs v2 (`tables/[tableId]/actions.ts`, track 002 P1.5)

- The table id alone is the credential/routing key (no siteId); standalone (`Restaurant.siteId =
  null`) and linked venues both work.
- `placeTabOrder` — find-or-create the open tab in-txn on the `openTableId` unique guard (P2002 →
  join existing); orders enter kitchen state `complete`; prices from `MenuItem`, not `Product`; anon
  `Order.userId = restaurant.partnerAccountId`; `siteId` dual-written only when linked to a Site.
- `getTabState` — open tab + rounds + `calculateTabTotal`, by `openTableId` alone, no ownership check.
- `getDineContext` — menu mapped to the legacy product-shaped DTO; gates: flag → table active →
  `restaurant.dineInEnabled`, no site lookup.
- More (claim rule, `releaseTabClaim`): `.claude/wiki/flows/table-booking.md`.
