# Sunbnb — Project Context

> Beach booking platform: discover sites, reserve sunbeds, order food & drinks, pay via Stripe. Two apps (consumer + partner portal) in a Turborepo monorepo.

---

## Architecture Overview

| Layer | Technology |
|---|---|
| Monorepo | Turborepo + npm workspaces |
| Package manager | npm |
| Build orchestrator | Turborepo (`turbo build`, `turbo dev`, `turbo lint`) |
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5 |
| Database | PostgreSQL + PostGIS (spatial queries) |
| ORM | Prisma 7 with `@prisma/adapter-pg` driver adapter |
| Auth | NextAuth v5 (beta) — JWT strategy |
| Payments | Stripe (+ demo mode) |
| State | Redux Toolkit + RTK Query |
| Styling | Tailwind CSS 3 + MUI 5 (progressive migration to pure Tailwind) |
| i18n | next-intl (EN, ES, FI) |
| Maps | Google Maps (`@vis.gl/react-google-maps`) |
| PDF | @react-pdf/renderer |
| Blob storage | Vercel Blob |
| Deployment | Vercel (Frankfurt `fra1`), git-based: `main` → `test` → `production` |

### Workspace Structure

```
sunbnb-app/                    # Root — Turborepo
├── apps/
│   ├── partner/               # Partner portal (port 3001)
│   ├── user/                  # Consumer app (port 3002)
│   ├── admin/                 # Platform admin (port 3003)
│   └── docs/                  # Docs (unused)
├── packages/
│   ├── data/                  # @repo/data — Prisma client, schema, migrations
│   ├── ui/                    # @repo/ui — Shared UI components (Button, TextField, Card, Code)
│   ├── eslint-config/         # @repo/eslint-config
│   └── typescript-config/     # @repo/typescript-config
├── turbo.json
├── deploy-to-production.sh    # Merges test → production branch
└── promote-to-test.sh         # Merges main → test branch
```

### Dev Servers

Both apps use custom HTTPS servers with local mkcert certificates (`./certificates/local.sunbnb.app-*.pem`):
- **Partner**: `https://local.sunbnb.app:3001`
- **User**: `https://local.sunbnb.app:3002`
- **Admin**: `https://local.sunbnb.app:3003`

### Key Environment Variables

- `POSTGRES_URL` — Database connection string
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLIC_KEY` — Stripe credentials
- `GOOGLE_MAPS_API_KEY` — Maps + Places
- `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` — NextAuth
- `AUTH_FACEBOOK_ID`, `AUTH_FACEBOOK_SECRET` — Facebook OAuth (user app only)
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob storage

---

## Database Schema (Prisma)

### Auth & Users

**User** — `id`, `name?`, `email` (unique), `emailVerified?`, `image?`, `password?`, `sudo` (bool, default false). Relations: Account[], PartnerAccount?, Site[], InventoryItem[], Reservation[], Order[], Session[], Authenticator[].

**Account** — OAuth provider accounts. Composite PK `[provider, providerAccountId]`. FK → User (cascade).

**Session** — `sessionToken` (unique), `userId`, `expires`. FK → User (cascade).

**VerificationToken** — `identifier`, `token`, `expires`. Composite PK `[identifier, token]`.

**Authenticator** — WebAuthn credentials. `credentialID` (unique), `userId`, keys, counters. FK → User (cascade).

### Partner Management

**PartnerAccount** — `userId` (PK, unique), `firstName`, `lastName`, `email`, `phoneNumber`, `company`, `websiteUrl?`, `address`, `bankAccount?`, `businessId?`. FK → User (cascade). Has Invoice[], ServiceFee[].

**SecurityToken** — `id`, `expires`, `resources[]` (string array), `userId`. No FK relation — standalone.

### Sites & Inventory

**Site** — `id`, `userId`, `name`, `locationLat/Lng`, `coords` (PostGIS geometry with GiST index), `description?`, `image?`, `imageWidth/Height?`, `type?`, `price?`, `vat?` (Float), `status` (default "active"), `services[]` (string array), `appSalesEnabled` (bool), `background?`, `bgImageUrl?`, `bgImageWidth/Height?`, `slug?`. FK → User. Has InventoryItem[], Product[], Reservation[], Order[], ServiceFee[], SiteWorkingHours[], SiteBrand?.

**SiteBrand** — `id`, `siteId` (unique), `brandName`, `bgImageUrl?`, `bgImageWidth/Height?`. FK → Site (cascade).

**SiteWorkingHours** — `id`, `siteId`, `day` (Int, 0-6), `openTime`, `closeTime`. FK → Site (cascade).

**InventoryItem** — `id`, `userId`, `siteId`, `number` (Int), `group` (Int, default 0), `itemGroupId?`, `locationLat/Lng`, `status`, `notes?`, `image?`, `label?`, `rotation?` (Float), `category?`, `price?` (Float), `pairId?` (unique, self-reference). FK → User, Site, ItemGroup?. Has self-ref pair relation, Reservation[] (M:N), Order[].

**ItemGroup** — `id`, `number`, `siteId`, `rows`, `seatsPerRow`, `locationLat/Lng`, `status` ("active"), `rotation`, `horizontalGap`, `verticalGap`, `pairGap`, `category?`, `price?`. Has InventoryItem[].

### Bookings

**Reservation** — `id`, `userId`, `siteId`, `itemId?`, `status` (default "pending"), `type` (default "hours"), `from`, `to` (DateTime), `paymentAmount?` (Float), `paymentRef?`, `invoiceId?` (unique), `anonId?`. FK → User, Site, Invoice?. Has Order[], InventoryItem[] (M:N via implicit join table `InventoryItemToReservation`).

**Product** — `id`, `name`, `description?`, `price` (Float, net), `tax` (Float, rate), `totalPrice` (Float, gross), `siteId`, `imageUrl?`, `imageWidth/Height?`, `active` (bool, default true). FK → Site.

**Order** — `id`, `invoiceId?` (unique), `price` (Float), `tax` (Float), `totalPrice` (Float), `siteId`, `status` (default "created"), `anonId?`, `paymentAmount?` (Float), `paymentRef?`, `userId`, `reservationId?`, `seatId?`. FK → Invoice?, Reservation?, InventoryItem? (seat), Site, User. Has OrderItem[].

**OrderItem** — `id`, `orderId`, `productId`, `quantity` (Int), `name`, `price` (Float), `tax` (Float, rate), `totalPrice` (Float). FK → Order (cascade).

### Billing & Invoicing

**Invoice** — `id`, `accountId` (FK → PartnerAccount, cascade), `status` (default "created"), `paymentRef?`, `totalCharge` (Float, net), `totalTax` (Float, default 0), `totalAmount` (Float, gross), `invoicedAt` (DateTime). Has InvoiceLine[], Order? (1:1), Reservation? (1:1).

**InvoiceLine** — `id`, `invoiceId`, `charge` (Float, net), `tax` (Float, default 0, VAT amount), `amount` (Float, gross), `description?`, `productCode?`. FK → Invoice (cascade).

Product codes used: `"sunbed-rental"`, `"food-and-beverage"`, `"sunbnb-service-fee"`.

### Service Fees & Settings

**Settings** — `id`, `country?`, `vat?` (Float), `currency?`. Has ServiceFee[]. Singleton-ish — global platform configuration.

**ServiceFee** — `id`, `settingsId` (required FK → Settings), `siteId?` (FK → Site), `accountId?` (FK → PartnerAccount), `chargeType` ("fixed" or percentage), `feeAmount?` (Float), `percentage?` (Float, multiplier e.g. 0.10 = 10%), `serviceCode` ("sunbed-rental" or "food-and-beverage"). FK → Settings (cascade), Site? (cascade), PartnerAccount? (cascade).

**Three-tier fee resolution**: site → partnerAccount → settings (first match by serviceCode wins).

---

## Authentication

### Partner App
- **Provider**: Google OAuth only
- **Callbacks**: Minimal — pass-through `jwt` and `session`
- **Guard**: `app.tsx` checks session; redirects unauthenticated to `/api/auth/signin`. Public routes: `/info`, `/manage`, site-slug pages
- **Authorization**: `authorizeSite()` helper verifies user owns the site or is a sudo user

### User App
- **Providers**: Google, Facebook, Credentials (email/password with bcrypt)
- **Strategy**: JWT (no database sessions)
- **Anonymous support**: `anonId` generated via UUID, stored in `localStorage('sunbnb-anonId')`, used for POS/QR reservation flows
- **Custom pages**: `signIn: '/account'`
- **Guard**: `app.tsx` routes to `AuthenticatedApp` or `UnauthenticatedApp` based on session

---

## Payment System

### Stripe Flow (Reservations)

```
1. User selects sunbeds + dates → reservation created (status: 'pending')
2. Navigate to /payment → StripePayment component
3. POST /api/payment/stripe/payment-intent → creates Stripe PaymentIntent
4. Reservation updated: paymentRef, paymentAmount, status='processing'
5. Stripe Elements (PaymentElement) renders card form
6. User confirms → stripe.confirmPayment() → redirect to /payment/complete
7. VerifyPayment polls GET /api/reservations/[id]
8. API verifies Stripe PI status → if 'succeeded':
   - Update reservation status to 'paid'
   - processConfirmedReservation() creates Invoice + InvoiceLines
   - Update reservation status to 'complete', attach invoiceId
9. Client detects 'paid'/'complete' → redirect to /reservations/[id]
```

### Stripe Flow (Orders / Food & Beverage)

```
1. User places order from Menu during reservation → saveOrder() creates Order
2. OrderPayment component renders
3. POST /api/order-payment/stripe/payment-intent → PaymentIntent (amount includes service fee)
4. Same Stripe Elements flow → redirect → poll → handleConfirmedOrder()
5. Invoice created with order line items + single service fee line
```

### Demo Mode

Server-controlled via `NEXT_PUBLIC_DEMO_MODE` environment variable.
- `initiateDemoReservationPayment`: Generates fake `pi_demo_{timestamp}` ref, runs `processConfirmedReservation` (wrapped in try/catch for resilience)
- `initiateDemoOrderPayment`: Same pattern for orders
- `DemoCheckoutForm`: Simulates redirect with fake `payment_intent` query params
- Same invoice creation logic executes via the polling API routes

### Invoice Creation — Reservations (`handleConfirmedReservation`)

Per reservation item (sunbed), creates **two** invoice lines:
1. **Product line**: `productCode: 'sunbed-rental'`, description: `Sunbed {number} ({category})`, amount = item price − service fee
2. **Fee line**: `productCode: 'sunbnb-service-fee'`, description: `Res. fee`, amount = service fee

Service fee is **deducted from partner revenue** (customer pays listed price).

### Invoice Creation — Orders (`handleConfirmedOrder`)

Creates **one line per order item** at full price + **one fee line** for the whole order:
- Item lines: `productCode: 'food-and-beverage'`
- Fee line: `productCode: 'sunbnb-service-fee'`, description: `Srv. fee`

Service fee is **added to customer total** (customer pays more).

### VAT Calculation

All prices are **VAT-inclusive**. Reverse calculation:
```
baseAmount = round(grossAmount / (1 + vatRate / 100))  // net
vatAmount  = round(grossAmount - baseAmount)            // VAT
```
VAT rate from `site.vat` (per-site), defaults to 0.

### Service Fee Calculation

```
if (chargeType === 'fixed') fee = feeAmount
else fee = percentage × price
```

---

## Partner App (`apps/partner`)

### Route Map

| Route | Purpose | Auth |
|---|---|---|
| `/` | Dashboard — KPI cards, revenue chart, upcoming reservations | ✓ |
| `/sites` | Sites listing — grid with status badges, stats, capacity | ✓ |
| `/sites/create` | 4-step site creation wizard (location → settings → content → done) | ✓ |
| `/sites/[id]` | Site detail — tabbed layout | ✓ |
| `/sites/[id]/general` | Site settings — name, type, price, VAT, working hours, map location, visibility | ✓ |
| `/sites/[id]/content` | Cover photo upload, description, service toggles | ✓ |
| `/sites/[id]/brand` | Brand customization — name, slug, colors, booking page options (WIP) | ✓ |
| `/sites/[id]/inventory` | Inventory editor — Google Maps with sunbed markers, parcels, bulk operations | ✓ |
| `/sites/[id]/products` | F&B product management — add/edit/delete with images | ✓ |
| `/sites/[id]/accounting` | Monthly accounting — revenue, tax, order/reservation breakdowns | ✓ |
| `/sites/[id]/orders` | Real-time order dashboard — live polling, complete/discard actions | Public |
| `/sites/[id]/manage` | On-site sunbed management — token-gated, reserve/unreserve for day | Public |
| `/calendar` | Monthly reservation calendar — site selector, day detail panel | ✓ |
| `/account` | Partner account settings — personal info, company, billing (IBAN) | ✓ |
| `/security` | API token management — create, list, delete | ✓ |
| `/reservations/[id]` | Individual reservation detail | ✓ |
| `/info` | Marketing landing page with animated chapters | Public |

### API Routes (Partner)

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/[...nextauth]` | GET, POST | NextAuth handlers |
| `/api/reservations/[siteId]` | GET | Day reservations (`?date=`) or monthly counts (`?month=&year=`) |
| `/api/reservations-cleanup` | GET | Cron (every 15 min) — deletes stale pending/processing/paid-in-cash reservations |

### Key Server Actions (Partner — split across focused modules)

**`apps/partner/app/sites/[id]/site-actions.ts`**: `saveGeneral`, `submitForm`, `deleteSite`, `setSiteStatus`

**`apps/partner/app/sites/[id]/content-actions.ts`**: `saveContentFields`, `uploadContentImage`

**`apps/partner/app/sites/[id]/inventory-actions.ts`**: `createInventoryItem`, `deleteInventoryItem`, `saveInventoryItemLocation`, `saveInventoryItemProperties`, `deleteItemsByGroup`

**`apps/partner/app/sites/[id]/working-hours-actions.ts`**: `addWorkingHours`, `deleteWorkingHours`

**`apps/partner/app/sites/[id]/queries.ts`**: `getSite` (exported), `resolveServiceFees` (private helper)

**`apps/partner/app/sites/[id]/manage/actions.ts`**: `reserveItem`, `unreserveItem` (token-gated, with auth + ownership checks)

### Inventory System

The inventory editor (`/sites/[id]/inventory`) is the most complex component:
- **Google Maps** with draggable sunbed markers
- **Parcels**: Groups of sunbeds arranged in grid layouts (rows × seatsPerRow)
- **Operations**: Create single/parcel, edit parcel (rearrange, resize, rotate), move group, multi-select (Ctrl/Cmd+click), delete
- **QR codes**: Print QR labels linking to POS reservation pages
- **Side panel**: Item detail form with label, price, status toggle, advanced settings, active reservations list
- **Price breakdown**: Shows customer price → service fee deduction → partner receives amount with VAT detail

### State Management (Partner)

**Redux slices:**
- `reservationsSlice` — generic key-value store
- **RTK Query** (`apiSlice`): `getReservations(siteId, date)`, `getReservationsByDay(siteId, date)`, `getReservationsByMonth(siteId, month, year)`

### Context

- `SiteContext` (`site-context.tsx`): Provides `site`, `setSite`, `apiKey`, `nonce` to all site sub-routes

---

## User App (`apps/user`)

### Route Map

| Route | Purpose | Auth |
|---|---|---|
| `/` | Landing page — hero, marketing sections, search | Public |
| `/sites` | Site discovery — list + map view, search by location | Public |
| `/sites/[id]` | Site detail — image, services, hours, reservation panel | Public |
| `/sites/[id]/pos` | POS reservation (QR code entry) — anonymous support | Public |
| `/sites/[id]/pos/[itemId]` | Direct item POS reservation | Public |
| `/reservations` | User's reservations — Active/History tabs | ✓ |
| `/reservations/[id]` | Reservation detail — swipeable confirmation + F&B menu | Mixed |
| `/reservations/[id]/pass` | QR ticket pass — printable | Mixed |
| `/reservations/[id]/receipt` | Invoice receipt — HTML + PDF download | Mixed |
| `/payment` | Stripe / Demo payment form | Mixed |
| `/payment/complete` | Payment verification + redirect | Mixed |
| `/account` | User account settings | ✓ |
| `/demo` | Demo mode activation + interactive showcase | Public |
| `/privacy` | Privacy policy | Public |
| `/tos` | Terms of service (locale-aware: EN/ES/FI) | Public |

### API Routes (User)

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/[...nextauth]` | GET, POST | NextAuth handlers |
| `/api/sites` | GET | Search sites by coordinates (PostGIS distance query) |
| `/api/sites/[id]` | GET | Single site with inventory + working hours |
| `/api/sites/[id]/availability` | GET | Check item availability for date range |
| `/api/reservations/[id]` | GET | Fetch reservation + verify Stripe payment + create invoice |
| `/api/reservations/[id]/find` | GET | Find reservation by paymentRef |
| `/api/orders/[id]` | GET | Fetch order + verify Stripe payment + create invoice |
| `/api/orders/[id]/find` | GET | Find order by paymentRef |
| `/api/payment/stripe/payment-intent` | POST | Create Stripe PI for reservation (with UUID validation) |
| `/api/order-payment/stripe/payment-intent` | POST | Create Stripe PI for order (with UUID validation) |
| `/api/webhooks/stripe` | POST | Stripe webhook — payment succeeded/failed/refunded |
| `/api/reconcile` | POST | Reconcile stuck payments (cron or manual, secret-protected) |
| `/api/places/autocomplete` | GET | Google Places proxy |
| `/api/places/details` | GET | Google Places details proxy |

### Key Server Actions (User)

**`apps/user/app/sites/[id]/actions.ts`**:
- `saveReservationForMultipleItems(data)` — multi-item reservation (auth/anonId required, status determined server-side from site.type, price calculated from DB)
- `findAnonReservation(anonId, itemId)` — find active reservation by anonymous ID
- `findUserReservation(userId, itemId)` — find active reservation by user ID

**`apps/user/app/reservations/[id]/actions.ts`**:
- `cancelReservation(id)` — cancel reservation + issue Stripe refund if paid
- `getProducts(siteId)` — active products for a site
- `createOrder(data)` — create order with items (DB prices enforced, quantity validated)
- `getOrderByPaymentRef(ref)` — lookup order by Stripe PI (with auth)
- `getOrders(reservationId)` — orders with items + invoices (with auth)

**`apps/user/app/payment/actions.ts`**:
- `initiateDemoReservationPayment(id)` — demo payment for reservation (ownership-verified, server-controlled)
- `initiateDemoOrderPayment(id)` — demo payment for order
- `getReservationById(id)` — fetch reservation (with auth)
- `getReservationByPaymentRef(ref)` — lookup by Stripe PI (with auth)
- `getOrderByPaymentRef(ref)` — lookup order by Stripe PI (with auth)

### Services

**`siteService.ts`**: PostGIS spatial queries — `findSitesByCoords()` uses `ST_DistanceSphere`, `ST_MakePoint`, `ST_Centroid`, `ST_Collect`, `ST_Extent` for site discovery with distance calculation and bounding box.

**`availabilityService.ts`**: Per-item availability check — for each active inventory item, queries overlapping reservations (statuses: pending, processing, paid, complete, paid-in-cash) using dayjs date range comparison.

### State Management (User)

**Redux slices** (built via `createKeyValueSlice` factory):
- `searchSlice` — `searchText`, `selectedPlace`, `searchSuggestions`
- `reservationSlice` (name: 'reservation') — `selectedItems`, `seatCategory`, `reservationType`, `from`, `to`, `orderState`, `pendingOrderId`, `panelBottom`, `panelHeight`, `panelFocused`
- `sitesSlice` (name: 'sites') — `selectedSiteId`, `selectedItemId`, `mapCenter`, `reservationDay`

**RTK Query:**
- `reservationApi`: `getReservation`, `getReservationByDate`, `getReservationsByMonth`, `getReservationByPaymentRef`, `getOrderByPaymentRef`
- `placesApi`: `getAutocomplete`, `getPlaceDetails`

### Key Components

- **SunbedSelection** (460 lines): Google Maps interactive sunbed selector with paired display, parcel polygons, zoom-responsive markers, availability overlay
- **SearchBar**: Google Places autocomplete with animated suggestions, Redux-integrated
- **ReservationConfirmation**: Status card with QR link, receipt link, color-coded status badges
- **Menu** (414 lines): Full F&B ordering system — product grid, quantity controls, basket drawer, order creation, payment flow
- **Header**: Search bar, user dropdown, animated glow canvas effect

---

## Cross-Cutting Patterns

### Data Fetching
- **Server components** fetch via Prisma directly (no API layer)
- **Client components** use RTK Query for polling/caching or call server actions directly
- **Auto-save pattern**: Debounced (1.5–2s) field changes trigger server actions → refresh site context

### Image Upload
- Vercel Blob (`@vercel/blob`) via `put()` in server actions
- Remote image pattern whitelisted in `next.config.mjs`
- Used for: site covers, background images, product photos

### Error Handling
- Server actions return `{ status: 'ok' | 'error', errors?: string[] }`
- UI shows success/error banners (green/red) with auto-dismiss

### i18n
- `next-intl` with `getRequestConfig()` detecting locale from `Accept-Language` header
- Message files: `messages/{en,es,fi}.json`
- Mostly used in user app; partner app has minimal translations

### Cron Jobs
- `/api/reservations-cleanup` (partner): Runs every 15 min (Vercel cron), cleans up stale pending/processing reservations older than 15 min and expired paid-in-cash reservations

### PostGIS
- Site coordinates stored as `geometry` type with GiST index
- Spatial queries: `ST_DistanceSphere` for distance, `ST_MakePoint` for point creation, `ST_Centroid`/`ST_Collect`/`ST_Extent` for map bounds
- Raw SQL via `prisma.$queryRawUnsafe()`

---

## Known Quirks

- `@repo/data` package exports both Prisma client AND duplicated UI components (TextField, Button, etc.) — same components also exist in `@repo/ui`
- Export path has typo: `"./PrismaCient"` (missing 'l' in Client)
- `messages/en.json` in partner app has typo: `"Acccount"` (triple 'c')
- MUI and Tailwind coexist — progressive migration toward pure Tailwind in the partner app
- Brand page (`/sites/[id]/brand`) is partially implemented — client state only, not persisted
- Reservation types include "hours" and "days" but hours mode is mostly disabled in the user app UI

---

## Shared Utilities

### API Auth (`apps/user/app/api/_lib/auth.ts`)
- `getRequestIdentity(request, bodyAnonId?)` — extracts userId from session or anonId from query/body
- `verifyOwnership(identity, entity)` — checks if requesting user owns the reservation/order (by userId or anonId)

### Stripe Helpers (`apps/user/app/api/_lib/stripe.ts`)
- `getStripeClient()` — creates Stripe instance (throws if STRIPE_SECRET_KEY missing)
- `getStripePaymentStatus(paymentRef)` — retrieves PI status from Stripe
- `isDemoPayment(paymentRef)` — checks `pi_demo_` prefix
- `isValidUUID(value)` — validates UUID v4 format

### Payment Service (`packages/data/src/payment.ts`)
- `processConfirmedReservation(id)` — idempotent: creates invoice + lines for completed reservation
- `processConfirmedOrder(id)` — idempotent: creates invoice + lines for completed order
- `resolveServiceFee(siteId, serviceCode)` — three-tier cascade: site → partnerAccount → settings
- `calculateOrderServiceFee(orderId)` — computes total service fee for an order
- `computeVatAndBaseAmounts(gross, vatRate)` — reverse VAT calculation with rounding
- `round(value)` — financial rounding to 2 decimal places
