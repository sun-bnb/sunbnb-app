# User App (apps/user)

Consumer-facing booking app — site discovery, sunbed reservations, F&B ordering, equipment rentals.

Port 3002 (`https://local.sunbnb.app:3002`). Run: `cd apps/user && source .env.local && npm run dev`

## Auth Model

Google, Facebook, Credentials (email/password with bcrypt). Anonymous support via `anonId` (UUID in `localStorage('sunbnb-anonId')`) for POS/QR flows. `app.tsx` routes to `AuthenticatedApp` or `UnauthenticatedApp` based on session. `auth.ts` at app root configures NextAuth.

## Route Map

| Route | Purpose | Auth |
|---|---|---|
| `/` | Landing page — hero, marketing sections, search | Public |
| `/sites` | Site discovery — list + map view, search by location | Public |
| `/sites/[id]` | Site detail — image, services, hours, reservation panel | Public |
| `/q/[site]` | **Short venue QR entry (track 022)** — `/q/S-K7M2X9`, the canonical form of `/sites/[id]/pos`. `Site.code` is the whole key: immutable (unlike the slug, whose rename would orphan every printed card) and 8 chars instead of a 25-char cuid. Code validated (`isValidSiteCode`) BEFORE any query, then folded through `normalizeSiteCode`, so a lowercase hand-typed URL resolves. Renders the same `PosView` via the shared `sites/[id]/pos/queries.ts` `getPosSite` | Public |
| `/q/[site]/[unit]` | **Short seat QR entry (track 022)** — `/q/S-K7M2X9/1-1-1`, the canonical form of `/sites/[id]/pos/[itemId]` and the URL printed on a lounger's card. 80 chars → 35, QR byte-mode v5 (37×37) → v3 (29×29). Keyed by the unit ADDRESS, not a seat row: the card belongs to the **spot**, so a parcel rebuilt in place keeps working (a genuine rearrange can re-point one — the accepted trade, matching how a device resolves). Resolution is `app/q/resolve.ts` `resolveQrTarget` — syntax checked pre-DB, code folded, unit fetched by `unitAddressWhere` on `UNIQUE(site_id, parcel, row_idx, seq)`, `pool` spares excluded, seats ordered by `number`. Accepts the four-segment seat id `1-1-1-2` (what `formatSeatId` prints on the card) as the same unit. Declines — never renders an empty unit — on unknown code, no unit at the address, or a unit holding only spares. Availability comes from the SAME `posAvailability` tail the legacy route uses | Public |
| `/sites/[id]/pos` | Legacy venue QR entry (id **or** slug) — **redirects to `/q/[site]`** when the site has a code, preserving query params; RENDERS as before when it does not. The fallback is deliberate: between deploying track 022 and running `backfill:site-codes` on an environment, an unconditional redirect would send every printed card to a URL resolving to nothing | Public |
| `/sites/[id]/pos/[itemId]` | Legacy seat QR entry — **redirects to `/q/[site]/[unit]`** when the site has a code AND the unit has an address, preserving query params; RENDERS as before when either is missing (production has not received track 021's `parcel`/`row_idx` columns, so every unit there falls back until it does). Availability decided SERVER-side in `pos/[itemId]/queries.ts` (`getPosContext`) via the canonical `getAvailabilityForItems`; the page ships `availableItemIds` and the client never re-derives it. The unit is drawn as art (one bed, or two beds under a shared parasol) with each seat's id above the bed it names, ordered by seat number so the picture is the same whichever bed's QR was scanned. On a site with `partialGroupBookingEnabled` (and a unit of 2+ beds) each bed is tappable: a **towel** lying at 30° marks a bed that is in the booking, the unit opens with every FREE bed towelled, the price strip follows the pick seat by seat, and an empty pick leaves RESERVE disabled with no price shown. Rules in the pure `pos-seat-selection.ts`. `getPosContext` excludes `pool` spares from the unit (`SEGMENT_SEATS`) — a spare parked on a unit is not a bed under that parasol, and surfacing it made the whole unit read "Reserved" forever, since a pool seat is never in the availability set. Was a client-side rule over an unfiltered `reservations` include, so canceled/refunded/payment_failed bookings blocked the seat forever and "today" was browser-midnight (fixed 2026-08-16) | Public |
| `/tables/[tableId]` | Dine-in tab ordering (v2, restaurant-anchored, canonical) — per-table QR landing, menu browse (MenuItem catalog), place rounds, view running tab, Close & pay (Mollie or demo), return-poll flow, paid state. No siteId — the table id alone is the credential/routing key; standalone (`Restaurant.siteId = null`) and linked venues both work | Public |
| `/sites/[id]/dine/[tableId]` | Legacy alias — redirects to `/tables/[tableId]`, preserving all query params (old printed QR codes, mid-flight Mollie `?tabReturn=` returns) | Public |
| `/reservations` | User's reservations — Active/History tabs | Auth |
| `/reservations/[id]` | Reservation detail — swipeable confirmation + F&B menu | Mixed |
| `/reservations/[id]/pass` | QR ticket pass — printable | Mixed |
| `/reservations/[id]/receipt` | Invoice receipt — HTML + PDF download | Mixed |
| `payment/Payment.tsx` (in-page) | Payment step rendered inside the reservation flow (Mollie redirect / demo form) — **not a standalone route**; `/payment` 404s | — |
| `/payment/complete` | Payment verification + redirect (Mollie returns here with `?reservationId`; demo with `?payment_intent`) | Mixed |
| `/account` | User account settings | Auth |
| `/demo` | Demo mode activation + interactive showcase | Public |
| `/s/[slug]` | Branded site page via slug | Public |
| `/s/[slug]/reservations` | Branded reservations page | Mixed |

## API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/[...nextauth]` | GET, POST | NextAuth handlers |
| `/api/auth/forgot-password` | POST | Password reset email (IP rate-limited) |
| `/api/auth/reset-password` | POST | Reset password with token (IP rate-limited, token hashed) |
| `/api/sites` | GET | Search sites by coordinates (PostGIS distance query) |
| `/api/sites/[id]` | GET | Single site with inventory + working hours |
| `/api/sites/[id]/availability` | GET | Check item availability for date range (public, 90-day max) |
| `/api/reservations/[id]` | GET | Fetch reservation + verify payment + create invoice |
| `/api/reservations/[id]/find` | GET | Find reservation by paymentRef |
| `/api/orders/[id]` | GET | Fetch order + verify payment + create invoice |
| `/api/orders/[id]/find` | GET | Find order by paymentRef |
| `/api/payment/mollie/create-payment` | POST | Create Mollie payment for reservation (redirectUrl origin-validated) |
| `/api/order-payment/mollie/create-payment` | POST | Create Mollie payment for order |
| `/api/tab-payment/mollie/create-payment` | POST | Create Mollie payment for dine-in tab (QR-credential, no ownership check; atomic claim TAB_OPEN→TAB_PENDING_PAYMENT before total computed) |
| `/api/tabs/[id]` | GET | Poll-fallback for tab payment status (QR-credential, no ownership check; minimal DTO `{ id, status, closedAt }`) |
| `/api/webhooks/mollie` | POST | Mollie webhook (paymentId format-validated) |
| `/api/reconcile` | POST | Reconcile stuck payments (RECONCILIATION_SECRET required) |
| `/api/places/autocomplete` | GET | Google Places proxy (input length-limited) |
| `/api/places/details` | GET | Google Places proxy (placeId regex-validated) |
| `/api/cron/send-reminders` | GET | Daily 07:00 UTC — sends reminder emails (CRON_SECRET) |
| `/api/hw/[code]/state` | GET | **HW API** (track 019 P1) — seat state for a mounted hardware device. Seats resolved from the device's **assigned ADDRESS** — one indexed `findUnique` on `SunbedGroup` `UNIQUE(site_id, parcel, row_idx, seq)` via the shared `@repo/data/unit-address` `unitAddressWhere` (track 021; was a parcel-wide fetch plus a JS row filter, because row used to live inside the encoded seat number — the resolver, the partner assign action and the seat-removal guard each re-derived it and could disagree). A device answers for whatever unit occupies its address today, so a parcel rebuilt at the same spot needs no re-assignment; no unit there ⇒ non-200, never a free bed. Venue-local day, projection over `deriveState`, `ETag`/`304`. **Poll cadence is a platform preference, not a constant**: `pollAfterSec` comes from `device-poll-interval-sec` (`@repo/data/preferences`, admin `/preferences`, default 60 s), read through the 5-min per-instance cache — at ~1.3 M polls/day a query per poll would cost more than the control saves. It sits inside the ETag-hashed `stable` object, so a cadence change busts the 304 that would otherwise hide it from a device parked on a free bed; an out-of-range or missing value falls back to 60 rather than reaching a potted device. Still one number for the whole fleet — state-aware cadence and night backoff stay deferred. **No auth — a soft client filter** (track 019 Q9): the request's `User-Agent` must CONTAIN `HW_CLIENT_UA` (an opaque needle; firmware sends `Sunbnb-Sensor/1 (<needle>)`, so a version bump needs no server change). It declines obvious non-sensor traffic pre-DB, it is **not** a credential — the data is public occupancy and the cost-abuse backstop is edge rate-limiting. Unset `HW_CLIENT_UA` fails CLOSED (503). Failed filter and unknown code get a uniform opaque 401; every other failure is non-200 so the device shows amber, never a false FREE. The filter (UA match, device-binding lookup, `normalizeCode`) is the shared `hw/[code]/hw-filter.ts` `screenDeviceRequest`, used by both HW routes so they can't drift. A `retired` device and one with no seats bound are both declined (an empty binding would aggregate to FREE); `provisioned` DOES serve, so bring-up isn't trapped behind a manual status flip. **Tracking rides this request (wire v2, 2026-09-12)**: the device's self-report is the `x-sunbnb-telemetry` request header (`fw=…;batt=…;rssi=…;up=…;polls=…;loc=…`, every key optional), parsed by `hw/[code]/device-report.ts` and recorded by the screen step BEFORE the assignment check — so an unassigned device (and, with an `x-sunbnb-partner` claim, an unknown code) reaches the fleet list from its first poll. The write is THROTTLED (`reportIsDue`: fw/loc change, ≥50 mV, ≥6 dB, uptime drop, or 5-min `lastSeenAt` floor) so track 025's 1–15 s cadence never multiplies the row writes; the one `Device` read the screen step already makes supplies the comparison. A failed write never changes the response |
| `/api/hw/[code]/telemetry` | POST | **HW API — LEGACY escape hatch** (track 019 P1.5 → P5 → wire v2). `{ fw, battMv, rssiDbm, upSec, polls, tempC?, loc? }` → `204`. Not the tracking path any more — that is the `x-sunbnb-telemetry` header on the state poll (above); firmware never called this route and the fleet list went blind. Kept for a report that outgrows a header. Same client filter (screened with `track: false`), same recorder (`device-report.ts` `recordDeviceReport`) but UNTHROTTLED. Once past the filter the `204` never depends on the body or the DB — telemetry must never fail the device's poll loop |

## Server Actions

- **`sites/[id]/actions.ts`**: `saveReservationForMultipleItems` (multi-item, auth/anonId required, price from DB; availability validated via the SCOPED `getAvailabilityForItems` — absent ids are unbookable, track 020 P2), `saveRentalBooking` (availability-checked), `findAnonReservation`, `findUserReservation`
- **`reservations/[id]/actions.ts`**: `cancelReservation` (+ provider refund via `issueRefund` if paid), `getProducts`, `createOrder` (DB prices enforced), `completeUnpaidOrder`, `getOrderByPaymentRef`, `getOrders`
- **`payment/actions.ts`**: `initiateDemoReservationPayment`, `initiateDemoOrderPayment`, `initiateDemoRentalPayment`, `initiateDemoTabPayment` (QR-credential, no ownership check; atomic claim + calculateTabTotal guard; on processConfirmedTabPayment error does NOT revert — poll route retries), `getReservationById`, `getReservationByPaymentRef`, `getOrderByPaymentRef`
- **`tables/[tableId]/actions.ts`** (dine-in tabs v2, restaurant-anchored, single `tableId` param — track 002 P1.5 + dine-in-v2 decoupling): `placeTabOrder` (find-or-create open tab in-txn on the `openTableId` unique guard, P2002 → join existing; orders enter kitchen state `complete`, prices from `MenuItem`, not `Product`; anon `Order.userId = restaurant.partnerAccountId`; dual-write `siteId`/`site` connect only when the restaurant is linked to a Site), `getTabState` (open tab + rounds + `calculateTabTotal` totals, queried by `openTableId` alone; no ownership check — QR-URL-as-credential), `getDineContext` (restaurant/table + MenuItem-sourced menu mapped to the legacy product-shaped DTO; gates: flag → table active → `restaurant.dineInEnabled` — no site lookup at all, table id is the sole credential/routing key)

## API Auth Helpers (`app/api/_lib/`)

- **`auth.ts`**: `getRequestIdentity(request, bodyAnonId?)` extracts userId from session or anonId from query/body. `verifyOwnership(identity, entity)` checks requesting user owns the resource.
- **`payment-ids.ts`**: `isDemoPayment(paymentRef)` (checks `pi_demo_` prefix), `isValidEntityId(value)` (CUID or UUID v4). Extracted from the removed Stripe lib when consumer Stripe was purged.
- **`mollie.ts`**: `getMollieClientForPartner(accessToken)`, `getValidMollieToken(partnerAccount)`, `findPartnerTokenForPayment(paymentId)`
- **`payment-provider.ts`**: `getPaymentStatus(paymentRef)`, `isPaymentSucceeded/Failed(status)`, `issueRefund(paymentRef)` — provider-agnostic abstraction over **Mollie + demo** (consumer Stripe removed)

## State Management

Redux slices (via `createKeyValueSlice` factory):
- `searchSlice` — `searchText`, `selectedPlace`, `searchSuggestions`
- `reservationSlice` — `selectedItems`, `seatCategory`, `reservationType`, `from`, `to`, `orderState`, `pendingOrderId`, `panelBottom`, `panelHeight`, `panelFocused`
- `sitesSlice` — `selectedSiteId`, `selectedItemId`, `mapCenter`, `reservationDay`, `viewMode` ('sunbeds' | 'equipment'), `reservationMode` ('days' | 'hours'), `focused` (drawer open state)

RTK Query: `reservationApi` (getReservation, getReservationByDate, etc.), `placesApi` (getAutocomplete, getPlaceDetails)

## Testing

```bash
npm run test              # unit + route + server action tests (Prisma mocked)
npm run test:watch
npm run test:integration  # against local sunbnb_test DB (real Prisma)
```

Full per-file inventory, mocking patterns and config detail: **`apps/user/TESTING.md`**.

## Key Patterns

- Payment verification: GET `/api/reservations/[id]` serves as polling fallback if webhook missed — checks provider status and processes if succeeded
- Anonymous flow: POS/QR users get `anonId` in localStorage, passed to server actions and API routes for ownership without requiring login
- Reservation creation: server-side availability check → create with DB prices (never trust client prices)
- Default-deny payment logic: use `=== 'paid'` (not `!== 'unpaid'`) to prevent unknown payment types from bypassing payment
- **Reservation state transitions (track 018)**: webhook/poll/reconcile failure reverts, demo initiation, and user cancel/delete delegate to `applyTransition` (`@repo/data/reservation-machine-apply`). `pay.fail` resolves collect-vs-online reverts BY STATE (metadata.collect not load-bearing); `user.delete` rejects PROCESSING bookings (in-flight payment could orphan); `user.cancel` runs the provider refund via a caller-supplied handler BEFORE the status write. Single-writer ratchet in `packages/data/src/reservation-machine-guard.test.ts`
- **Partial group booking** (`Site.partialGroupBookingEnabled`, partner site General tab): sunbed selection is unit-granular by default — a click takes or drops the whole SunbedGroup. With the flag on, the FIRST click on an untouched unit still takes the whole unit and every click after that toggles ONE seat, so a guest can trim a unit down to a single bed; emptying a unit returns it to untouched. The policy is one pure module — `app/sites/[id]/seat-selection.ts` `toggleSeatSelection` — shared by `SunbedSelection` (geo) and `SchematicSelection` so the two canvases cannot drift; both surfaces read the flag off the site payload (all Site scalars arrive via `include`). Selection now also drops unit members that are NOT available, in both modes: a unit can be partly booked, and co-selecting a seat someone else holds only earned a server-side rejection of the whole reservation. Same for the on-open preselection (`pickFirstAvailablePair`). The `/sites/[id]/pos` map renders the same component, so it follows the site's policy too, and the per-seat QR page (`/sites/[id]/pos/[itemId]`) has its own rule set — the unit opens fully selected and a tap is only ever about that bed, because the guest is already standing at the parasol. **Not yet enforced server-side** — `saveReservationForMultipleItems` books exactly the ids it is sent and never expanded units, so nothing regressed, but the flag is a client-side policy until the venue and POS flows land.
- Equipment rentals: supports hourly and daily bookings. `viewMode` (sunbeds/equipment) stored in Redux so the mobile drawer can adapt its peek height to content. Tab switching opens the drawer automatically
- Mobile reservation drawer: fixed bottom panel with peek (minimized) and expanded states. Peek height varies by tab — sunbeds shows date range only, equipment shows hours/days toggle + time picker. Drawer opens on tab switch
- Error handling: server actions return `{ status: 'ok' | 'error', errors?: string[] }`. API error responses use generic messages (no internal details leaked)
- **Bespoke brand pages** (track 023): `/s/[slug]` renders a per-site React module from `brands/<key>/` when `resolveBrandRender` (`@repo/data/brand-manifest`) says both gates pass — a `Site.customBrandKey` naming a module in `BRAND_KEYS`, and `Site.customBrandEnabled` on. Anything else (off, no key, a key nothing answers to) renders the standard branded page: a bespoke page that is missing or misconfigured must cost the customer their design, never their bookings. **`brands/` sits outside `app/`** so the router never walks it, and a brand has full access to the app on purpose — it should reuse the drawer, the availability read and the translations rather than re-implement them. It must mount `components/booking/BookingSurface` instead of copying the funnel. **Code splitting is subtle and measured, not assumed**: a bare `() => import(…)` awaited in a server component does NOT split (every brand lands in `/s/[slug]`'s page chunk), and neither does `next/dynamic` called from server code — only a `dynamic()` reached through the `BrandMount` CLIENT boundary emits one chunk per brand. `registry.test.ts` guards that with a source check; re-verify by rebuilding and grepping `.next/static/chunks` for a string unique to one brand. **Consequence for verification: a brand page is NOT in the server HTML** — it arrives in its own client chunk, so `curl | grep` cannot see it and will report the standard page. Verify a deployed brand page in a BROWSER; a grep against the response is structurally blind to it (this cost a false 'deployment is broken' diagnosis on test). Tailwind must scan `./brands/**` or brand-only classes are purged.
- **The booking funnel is ONE component** (track 023 P2): `components/booking/BookingSurface.tsx` owns the whole funnel — the sticky sidebar at `lg`, the fixed peek-and-expand drawer below it, the scrim, the minimise pill, the on-mount bootstrap (`focused: true` + today as `reservationDay`, track 014) and the `ReservationView` mount. `SiteView` is the page AROUND it (cover, counts, services, description, opening hours) and mounts it once; the branded `/s/[slug]` page gets it through the same `SiteView`. **Custom brand pages mount this instead of copying the drawer** — a bespoke shell that copies it inherits a copy that stops matching the day the payment step, the seat-selection policy or the drawer mechanics change. Contract: `{ site, apiKey, theme?, openOnMount? }` — `openOnMount` (default true) is the track-014 reserve-first auto-open; a brand shell whose hero IS the landing moment opts out (Alcúdia does), and every later opener (the peeked date field's `onOpen`, a CTA dispatching `focused: true`, tab switches) still works, so opting out delays the funnel, never hides it; `reservationDay` is committed on mount regardless. `theme` is deliberately NOT `SiteViewBrand` (the funnel does not care about a brand name, tagline or logo — only the two colours). It coordinates through the `sites` slice (`focused`, `reservationDay`, `reservationMode`, `viewMode`) rather than callbacks, which is why it needs none. Peek arithmetic lives in the pure `app/sites/[id]/peek-height.ts`.
- **Seat ids** (track 021): everywhere a seat is shown to a guest — reservation confirmation, reservation item, QR pass, receipt, branded reservations page, POS — uses `formatSeatId` (`@repo/data/seat-label`), rendering `{parcel}-{row}-{seq}-{member}` (`1-1-1-2`). It UNPACKS the stored `seatLabel`, whose middle segment packs row and unit ordinal (`1-101-2`); nothing stored changes, so a device still resolves the same spot. Receipts and passes render live, so an OLD reservation now displays the new form too — the seat is the same, only its rendering changed.
- UI / design system: see **`apps/user/UI.md`** (user design-system layer) + the general **`.claude/rules/ui.md`**; prime UI work with `/ui user`.
