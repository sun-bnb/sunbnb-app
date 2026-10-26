# Partner App (apps/partner)

B2B portal for venue operators — site management, inventory editing, order dashboard, accounting,
on-site operations.

Port 3001 (`https://local.sunbnb.app:3001`). Run: `cd apps/partner && source .env.local && npm run dev`

**Pulled on demand** (not auto-loaded — read the one your task touches):

- `apps/partner/TESTING.md` — test inventory, meta-guards, auth-matrix semantics, mocking traps
- `apps/partner/ASSISTANT.md` — AI assistant surface detail (routes, tools, kinds, sql, limits)
- `apps/partner/PATTERNS.md` — site codes/QR, seat ids, payload + parcel tiering, inventory
  revalidation, brand tab, partial group booking, dine-in QR, rentals UI
- `apps/partner/UI.md` — partner design-system layer (prime with `/ui partner`)

## Auth Model

`app/auth.ts` (NextAuth v5, JWT, 8 h idle `maxAge`). Providers: **Google, Facebook, Credentials**
(email/password via `validateOrCreateUser`), plus an `impersonation` Credentials provider
consuming the admin app's single-use token (`consumeImpersonationToken`).
`app.tsx` redirects unauthenticated visitors to `/api/auth/signin`; public routes: `/info`,
`/manage`, site-slug pages. `requireSiteOwner()` / `authorizeSite()` verify site ownership (sudo
bypasses). Detail: `.claude/wiki/subsystems/auth.md`.

## Route Map

| Route | Purpose | Auth |
|---|---|---|
| `/` | Dashboard — KPI cards, revenue chart, upcoming reservations | Auth |
| `/sites` | Sites listing — status badges, stats, capacity | Auth |
| `/sites/create` | 4-step creation wizard (location → settings → content → done) | Auth |
| `/sites/[id]` | Site detail — tabbed layout | Auth |
| `/sites/[id]/general` | Name, type, price, VAT, working hours, map location, reservation rules | Auth |
| `/sites/[id]/content` | Cover photo, description, service toggles | Auth |
| `/sites/[id]/brand` | Brand name/slug/tagline/colors, auto-saved; bespoke-page rules in `PATTERNS.md` | Auth |
| `/sites/[id]/inventory` | Inventory editor — Google Maps, sunbed markers, parcels, bulk ops | Auth |
| `/sites/[id]/products` | F&B product management with images | Auth |
| `/sites/[id]/accounting` | Monthly accounting — revenue, tax, breakdowns, staff till card | Auth |
| `/sites/[id]/orders` | Live order dashboard; table chip for dine-in rounds (`Order.tableId`) | Public |
| `/sites/[id]/manage` | On-site management — token-gated landing | Public |
| `/sites/[id]/manage/sunbeds` | Sunbed grid — walk-ins, check-in/departure, rentals | Public |
| `/sites/[id]/manage/summary` | Daily summary — admin token, per-employee till totals | Public |
| `/sites/[id]/manage/close` | Day close (cierre de caja) — admin token, two-step `closeDay` | Public |
| `/sites/[id]/rentals` | Equipment rental item CRUD | Auth |
| `/calendar` | Monthly reservation calendar, day detail panel | Auth |
| `/account` | Personal info, company, billing (IBAN) | Auth |
| `/account/payments` | Provider hub (track 028) — select-then-connect; banner while selected ≠ effective | Auth |
| `/account/stripe` | Stripe Connect own-form wizard (`steps.ts`), then embedded components | Auth |
| `/account/staff` | Per-account `Employee` roster (current-worker chip source) | Auth |
| `/account/invoices` | PLATFORM commission invoices to the partner, by month | Auth |
| `/account/invoices/[id]` | Printable `F1` commission invoice (AEAT QR, `VERI*FACTU`) | Auth |
| `/security` | API token (SecurityToken) management | Auth |
| `/reservations/[id]` | Reservation detail | Auth |
| `/frontdesk` | Front-desk search + check-in/depart/no-show/cancel | Auth |
| `/devices` | Device fleet — per-device power-policy badge + editor (track 025) | Auth |
| `/restaurants/[id]/…` | Restaurant tabs, tables + dine-in QR, kitchen `orders` (token-or-session) | Auth |
| `/info` | Marketing landing page | Public |

`/account/invoices` lists `issuerType: 'PLATFORM'` only; the accounting page's `getInvoicesByMonth`
shows only `PARTNER`. `buildCommissionInvoice` returns null for both "not yours" and "no such invoice".

## API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/[...nextauth]` | GET, POST | NextAuth handlers |
| `/api/reservations/[siteId]` | GET | Day reservations (`?date=`) or monthly counts (`?month=&year=`) |
| `/api/reservations-cleanup` | GET | Cron (15 min) — stale pending/processing/hold cleanup |
| `/api/onboarding-status` | GET | Live-syncs Mollie/Viva/Stripe state → `syncEffectiveProviderSafe` |
| `/api/stripe-connect/account-session` | POST | Embedded Connect client secret; 400 until details submitted |
| `/api/stripe-connect/webhook` | POST | `account.updated`/`capability.updated` → `PartnerAccount` columns → sync |
| `/api/assistant` (+ `uploads/[id]`, `aerial/[uploadId]/extract`) | POST, GET | AI assistant — `ASSISTANT.md` |
| `/api/cron/purge-assistant-uploads` | GET | Cron (daily 03:40 UTC) — expired assistant blobs |

`/api/onboarding-status` returns the neutral fields `provider` (effective), `selected`,
`readiness`/`selectedReadiness`, `selectedDiffersFromEffective`; Mollie-era fields stay one
release. The Connect webhook verifies `STRIPE_CONNECT_ACCOUNT_WEBHOOK_SECRET` (503 unset).

## Server Actions

| File (under `app/`) | Actions |
|---|---|
| `sites/[id]/site-actions.ts` | `saveGeneral`, `submitForm`, `deleteSite`, `setSiteStatus`, `setPartialGroupBooking`, `saveBrand`, `saveSlug`, `checkSlug`, `generateSlug`, `getBrand`, `setPaymentProvider` (retired → `/account/payments`) |
| `sites/[id]/content-actions.ts` | `saveContentFields`, `uploadContentImage` |
| `sites/[id]/inventory-actions.ts` | `createInventoryItem`, `deleteInventoryItem`, `deleteInventoryItems` (bulk, one txn), `saveInventoryItemLocation`, `saveInventoryItemProperties`, `deleteItemsByGroup` |
| `sites/[id]/inventory/actions.ts` | `moveParcel`, `moveItems`, `rotateSelection`, `adjustItemSpacing`, `reverseParcel*`, group ops, `syncChairsWithLayout` |
| `sites/[id]/inventory/parcel-ops.ts` | `rotateParcel`, `applyParcelConfig`, `rotateUnit`, `setSeatsStatus` — shared by editor + assistant |
| `sites/[id]/working-hours-actions.ts` | `addWorkingHours`, `deleteWorkingHours` |
| `sites/[id]/queries.ts` | `getSite`, `getInventoryItems` (scoped refresh), private `resolveServiceFees` |
| `restaurants/[id]/queries.ts` | `getRestaurant`, `getRestaurantLayout`, `getRestaurantMenu`, `getRestaurantShifts`, `getRestaurantCombinations`, `getRestaurantWaitlist`, `getTablesList` |
| `sites/[id]/manage/actions.ts` | Floor ops (token-or-session) — see below |
| `sites/[id]/rentals/actions.ts` | `getRentalItems`, `createRentalItem`, `updateRentalItem`, `deleteRentalItem`, `toggleSiteFeature` |
| `sites/[id]/accounting/actions.ts` | `getPaidItemsByMonth` (`{ orders, reservations, tabs }`), `getInvoicesByMonth`, `getRevenueTrend`, `getOccupancyTrend`, `getRevenueCsv`, `getStaffTill` |
| `account/payments/actions.ts` | `selectPaymentProvider` — validates country availability, then syncs effective |
| `account/stripe/actions.ts` | `startStripeOnboarding`, `submitStripeBusinessProfile`, `submitStripeBankAccount`, `acceptStripeTerms`, `refreshStripeStatus`, `disconnectStripe` |
| `account/staff/actions.ts` | `getEmployees`, `createEmployee`, `renameEmployee`, `setEmployeeActive`, `deleteEmployee` |
| `assistant/{actions,upload-actions,aerial-actions}.ts` | `apply/reject/undoAssistantAction`, `uploadAssistantFile`, `saveUploadGeoref` |
| `security/actions.ts` | `getTokens`, `getOwnedSites`, `createToken`, `deleteToken` |

Notes:

- `sites/[id]/queries.ts` companions are PLAIN modules (a `'use server'` file may export async
  functions only): `item-select.ts` (`INVENTORY_ITEM_SELECT`), `item-counts.ts`
  (`getSiteItemCounts`, `todayReservationsWindow`).
- `saveBrand` rejects token writes while a bespoke page is live; `saveSlug` is always allowed.
- Stripe actions return `StripeActionResult` (next step + due requirements); every
  connection-state write ends in `syncEffectiveProviderSafe`.
- Staff actions are session-scoped (`accountId === session.user.id`).
- **Manage actions**: `reserveItem`, `unreserveItem`, `checkInReservation`, `resumeWalkIn`,
  `undoDepartWalkIn`, `markDeparted`, `markNoShow`, `updateReservationNotes`, `moveReservation`,
  `blockBed`, `unblockBed`, `holdBed`, `compBed`, `convertHoldToWalkIn`, rental ops
  (`markRentalPickedUp`, `markRentalReturned`, `createWalkInRental`), QR collect
  (`collectReservationPayment`, `getCollectStatus`, `cancelCollection`), `getStripeConnectionToken`,
  till (`getTillStatus`, `closeTill`).
- `collectReservationPayment(…, {method:'tap-to-pay'})` starts a Stripe Tap to Pay
  PaymentIntent (effective provider `stripe` + `cardPresent: 'tap-to-pay'`); it and
  `getStripeConnectionToken` are in the manage RPC registry for the floor app.
- On-site creates take an optional trailing `employeeId`, validated via `resolveEmployeeId`;
  cash walk-ins record `paymentAmount` for the till.
- **Inventory revalidation is deliberate**: `inventory/actions.ts` bulk ops do NOT
  `revalidatePath` — the client merges `refreshItems()` (track 020); `inventory-actions.ts` and
  `parcel-ops.ts` do. New actions choose one on purpose (`PATTERNS.md`).

## State Management

Redux slices: `reservationsSlice` (key-value store). RTK Query (`apiSlice`): `getReservations`,
`getReservationsByDay`, `getReservationsByMonth`. `SiteContext` provides `site`, `setSite`
(accepts an updater), `apiKey`, `nonce` to site sub-routes and merges fresh server props.

## Testing

```bash
npm run test              # unit tests (Prisma mocked)
npm run test:watch
npm run test:coverage
npm run test:integration  # real sunbnb_test DB
```

Meta-guards in `app/test/` enforce architecture invariants: auth matrix over every gated action,
gated-action registry completeness, mock-drift contract, no inline money, no hardcoded tier
pricing, no `pairId` writes. Adding a gated server action without registering it fails the build.
No React component tests (no jsdom) — `.tsx` is verified by `tsc`. Detail: **`TESTING.md`**.

## Key Patterns

- **Reservation transitions** go through the state machine (`@repo/data/reservation-machine-apply`,
  track 018) from manage, `frontdesk/actions.ts` and `reservations/[id]/actions.ts`; add
  transitions by editing the TABLE, not guards in actions. → `.claude/wiki/subsystems/reservation-state-machine.md`
- **Payment providers** (track 028): `Site.paymentProvider` is derived, never written; every
  connection-state write calls `syncEffectiveProviderSafe` (`app/api/_lib/sync-effective-provider.ts`,
  best-effort). → `.claude/wiki/subsystems/payments.md`
- Partner readiness UI (`PaymentsBanner`, sites list, readiness checklist, site payload
  `paymentReadiness`/`cardPresent`, General-tab card) reads `providerReadiness` only;
  `CardTerminalsCard` renders only for `cardPresent === 'terminal-app'`.
- **Ownership & manage tokens**: site mutations use `requireSiteOwner()`/`verifySiteOwnership()`;
  manage actions take an optional `accessKey` (scope `'all'`/`'manage_site'`; admin tier via
  `verifySiteAdmin`). → `.claude/wiki/subsystems/auth.md`, `.claude/rules/auth.md`
- **Floor staff & till** (tracks 008/013/016): roster, current-worker chip, day-anchored till,
  daily summary, day close, monthly roll-up. → `.claude/wiki/subsystems/employee-till.md`
- **Device power policy** (`/devices`, track 025): `setDevicePowerPolicy`/`clearDevicePowerPolicy`,
  resolved server-side with `resolveDevicePolicyForDevice`, no `identify`.
  → `.claude/tracks/025-device-power-modes.md`
- **Inventory, site codes, seat ids, payload tiering**: → `apps/partner/PATTERNS.md`
- Restaurants / dine-in tables: → `.claude/wiki/subsystems/table-reservations.md` + `PATTERNS.md`
- UI: `apps/partner/UI.md` + `.claude/rules/ui.md`; prime with `/ui partner`.

## AI assistant (track 030)

Site-shell drawer that answers questions and makes changes with Undo across every tab. The model
never writes: `propose_*` tools act immediately via `proposals/act.ts` `createAndApply` (deletes
stay proposed behind a typed confirm). Gates: account flag `assistant` + `assistantAvailable()`
kill switch; `siteId` is route-bound and every tool re-runs `requireSiteOwner`. Data questions run
SQL on the real DB as `assistant_reader` (RLS). Detail: **`ASSISTANT.md`**; model:
`.claude/wiki/subsystems/partner-assistant.md`.

## Analytics (GA4 + PostHog)

`NEXT_PUBLIC_GA4_ID` (shared with try.sunbnb.app; unset = no tag). `<GoogleAnalytics>` +
`<CookieConsent hasAnalytics>` in `app/layout.tsx`; nothing loads until consent. Events go through
`trackOnce(onceKey, name, params)` / `<TrackEvent>` (`components/Analytics.tsx`); pure rules in
`lib/analytics.ts`. Never put email/name/user ids in params. `gaEvent` also forwards to PostHog
(`@repo/ui/posthog`, `NEXT_PUBLIC_POSTHOG_KEY`, `/ingest` rewrite), which identifies by user id only.

Events: `sign_up`/`login` (stamped in the `jwt` callback in `app/auth.ts`, fired by
`<AuthEvents>`), `generate_lead`/`select_content` (landing CTAs), `site_created`,
`inventory_saved`, `site_published`, `payments_connected` (provider), `purchase` (subscription
Checkout return `/account/subscription?checkout=success&session_id=`, re-read from Stripe).
