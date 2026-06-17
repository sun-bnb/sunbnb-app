# Partner App (apps/partner)

B2B portal for venue operators — site management, inventory editing, order dashboard, accounting, on-site operations.

Port 3001 (`https://local.sunbnb.app:3001`). Run: `cd apps/partner && source .env.local && npm run dev`

## Auth Model

Google OAuth only. `app.tsx` checks session; redirects unauthenticated to `/api/auth/signin`. Public routes: `/info`, `/manage`, site-slug pages. `authorizeSite()` / `requireSiteOwner()` helpers verify user owns the site or is a sudo user. `auth.ts` at app root configures NextAuth.

## Route Map

| Route | Purpose | Auth |
|---|---|---|
| `/` | Dashboard — KPI cards, revenue chart, upcoming reservations | Auth |
| `/sites` | Sites listing — grid with status badges, stats, capacity | Auth |
| `/sites/create` | 4-step site creation wizard (location → settings → content → done) | Auth |
| `/sites/[id]` | Site detail — tabbed layout | Auth |
| `/sites/[id]/general` | Site settings — name, type, price, VAT, working hours, map location | Auth |
| `/sites/[id]/content` | Cover photo upload, description, service toggles | Auth |
| `/sites/[id]/brand` | Brand customization — name, slug, colors (partially implemented) | Auth |
| `/sites/[id]/inventory` | Inventory editor — Google Maps with sunbed markers, parcels, bulk ops | Auth |
| `/sites/[id]/products` | F&B product management — add/edit/delete with images | Auth |
| `/sites/[id]/accounting` | Monthly accounting — revenue, tax, order/reservation breakdowns | Auth |
| `/sites/[id]/orders` | Real-time order dashboard — live polling, complete/discard actions | Public |
| `/sites/[id]/manage` | On-site management — token-gated, sunbed grid + rental bookings | Public |
| `/sites/[id]/rentals` | Equipment rental item CRUD | Auth |
| `/calendar` | Monthly reservation calendar — site selector, day detail panel | Auth |
| `/account` | Partner account settings — personal info, company, billing (IBAN) | Auth |
| `/security` | API token management — create, list, delete | Auth |
| `/reservations/[id]` | Individual reservation detail | Auth |
| `/info` | Marketing landing page with animated chapters | Public |

## API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/[...nextauth]` | GET, POST | NextAuth handlers |
| `/api/reservations/[siteId]` | GET | Day reservations (`?date=`) or monthly counts (`?month=&year=`) |
| `/api/reservations-cleanup` | GET | Cron (every 15 min) — cleans stale pending/processing reservations |

## Server Actions

- **`sites/[id]/site-actions.ts`**: `saveGeneral`, `submitForm`, `deleteSite`, `setSiteStatus`, `setPaymentProvider`, `saveBrand`, `checkSlug`, `generateSlug`, `getBrand`
- **`sites/[id]/content-actions.ts`**: `saveContentFields`, `uploadContentImage`
- **`sites/[id]/inventory-actions.ts`**: `createInventoryItem`, `deleteInventoryItem`, `saveInventoryItemLocation`, `saveInventoryItemProperties`, `deleteItemsByGroup`
- **`sites/[id]/working-hours-actions.ts`**: `addWorkingHours`, `deleteWorkingHours`
- **`sites/[id]/queries.ts`**: `getSite` (exported), `resolveServiceFees` (private helper)
- **`sites/[id]/manage/actions.ts`**: `reserveItem`, `unreserveItem`, `checkInReservation`, `markDeparted`, `markNoShow`, `updateReservationNotes`, `moveReservation`, `blockBed`, `unblockBed`, `markRentalPickedUp`, `markRentalReturned`, `createWalkInRental` (token-gated)
- **`sites/[id]/rentals/actions.ts`**: `getRentalItems`, `createRentalItem`, `updateRentalItem`, `deleteRentalItem`, `toggleSiteFeature`

## State Management

Redux slices: `reservationsSlice` (key-value store). RTK Query (`apiSlice`): `getReservations`, `getReservationsByDay`, `getReservationsByMonth`. Context: `SiteContext` provides `site`, `setSite`, `apiKey`, `nonce` to site sub-routes.

## Testing

```bash
npm run test              # unit tests (901 tests across 31 files, Prisma mocked)
npm run test:watch        # vitest in watch mode
npm run test:coverage     # unit tests with Istanbul coverage report
npm run test:integration  # integration tests (89 tests across 7 files, real sunbnb_test DB)
```

### Test architecture spine

The test suite includes four meta-guards that enforce architecture invariants:

- **`app/test/auth-matrix.test.ts`** (376 tests) — Drives every action in the gated-action registry (`app/test/gated-actions.ts`) through all auth scenarios (no session, wrong owner, token-only, sudo). The single source of truth for "which actions exist and which gates they must respect."
- **`app/test/coverage-contract.test.ts`** (4 tests) — Fails if the gated-action registry omits an exported server action that has an auth gate in its source. Prevents new actions from silently skipping the matrix.
- **`app/test/mock-contract.test.ts`** (9 tests) — Verifies that the `@repo/data` mock modules expose every export from the real source packages. Prevents silent mock drift (new real export never added to mock → tests silently skip code paths).
- **`app/test/no-inline-money.test.ts`** (2 tests) — Rejects hardcoded monetary literals (`0.XX`, `XX.00`) in server-action source files; enforces use of DB-fetched prices.

### Unit tests (`vitest.config.ts`)

Path aliases redirect `@repo/data/PrismaCient` → mock, `@repo/data/password-reset` → mock, `@repo/data/rate-limit` → mock, `@repo/data/subscription` → mock.

Mock modules (`__mocks__/@repo/data/`): `PrismaCient.ts`, `password-reset.ts`, `rate-limit.ts`, `subscription.ts`, `reservation-emails.ts`.

| File | What it tests | Tests |
|---|---|---|
| `lib/validation.test.ts` | validateImageFile, validatePassword, enum validators | 45 |
| `app/sites/[id]/site-actions.test.ts` | saveGeneral, submitForm, deleteSite, setSiteStatus, setPaymentProvider, checkSlug, saveBrand | 37 |
| `app/sites/[id]/inventory-actions.test.ts` | CRUD, auto-increment, ownership, cross-site pair validation | 28 |
| `app/sites/[id]/inventory/actions.test.ts` | schematic/pool seat inventory actions | 10 |
| `app/sites/[id]/schematic/actions.test.ts` | schematic layout actions | 16 |
| `app/sites/[id]/products/actions.test.ts` | toggleAppSales, setOrderPaymentType, updateProduct VAT recalc, soft-delete, soldOut | 30 |
| `app/sites/[id]/orders/actions.test.ts` | order status transitions (complete→accepted→preparing→ready→delivered), rejection, discard | 19 |
| `app/sites/[id]/manage/actions.test.ts` | walk-in reserveItem, checkIn/departure/noShow state machine, moveReservation, blockBed, rental pickup/return, createWalkInRental | 84 |
| `app/sites/[id]/manage/grid-helpers.test.ts` | manage grid layout and seat ordering helpers | 28 |
| `app/sites/[id]/rentals/actions.test.ts` | getRentalItems, createRentalItem, updateRentalItem, deleteRentalItem, toggleSiteFeature | 46 |
| `app/sites/[id]/working-hours-actions.test.ts` | addWorkingHours, deleteWorkingHours, overlap validation | 21 |
| `app/sites/[id]/queries.test.ts` | getSite query | 3 |
| `app/sites/create/actions.test.ts` | site creation wizard actions | 6 |
| `app/calendar/actions.test.ts` | createPartnerReservation (auth, availability, double-booking, paired items), getAvailableSunbeds | 12 |
| `app/restaurants/[id]/actions.test.ts` | restaurant CRUD, settings | 20 |
| `app/restaurants/[id]/actions.shifts-and-duplicate.test.ts` | shift management and duplicate-opening guard | 15 |
| `app/restaurants/[id]/menu/actions.test.ts` | menu item CRUD | 9 |
| `app/restaurants/[id]/tables/actions.test.ts` | table CRUD and combination management | 13 |
| `app/restaurants/[id]/reservations/actions.test.ts` | table reservation lifecycle | 20 |
| `app/api/reservations-cleanup/route.test.ts` | cron auth, stale reservation cleanup | 5 |
| `app/api/subscription/webhook/route.test.ts` | Stripe signature verification, subscription events, status mapping | 7 |
| `app/api/auth/forgot-password/route.test.ts` | rate limiting, email validation, enumeration protection | 7 |
| `app/api/auth/reset-password/route.test.ts` | rate limiting, token/password validation | 7 |
| `app/api/auth/impersonate/route.test.ts` | sudo impersonation start | 4 |
| `app/api/auth/end-impersonation/route.test.ts` | impersonation end | 4 |
| `app/api/onboarding-status/route.test.ts` | Mollie onboarding status sync and caching | 7 |
| `app/api/reservations/[siteId]/route.test.ts` | ownership, date/month queries, HTTP status codes | 7 |
| `app/test/auth-matrix.test.ts` | auth gate matrix over all gated actions | 376 |
| `app/test/coverage-contract.test.ts` | gated-action registry completeness | 4 |
| `app/test/mock-contract.test.ts` | mock module superset of real exports | 9 |
| `app/test/no-inline-money.test.ts` | no hardcoded monetary literals in server actions | 2 |

### Integration tests (`vitest.integration.config.ts`)

Requires local Docker Postgres with `sunbnb_test` DB. No `@repo/data` mocks — all DB logic runs against real Postgres.

| File | What it tests | Tests |
|---|---|---|
| `app/sites/[id]/manage/actions.integration.test.ts` | reserveItem, checkIn, blockBed, rental pickup/return, walk-in rental (real conflict guard) | 27 |
| `app/calendar/actions.integration.test.ts` | createPartnerReservation (real DB writes, availability, cash payment) | 19 |
| `app/sites/[id]/orders/actions.integration.test.ts` | order status transitions and invoice creation against real DB | 13 |
| `app/sites/[id]/site-actions.integration.test.ts` | saveGeneral persists to DB, PostGIS coords, entitlement gate | 12 |
| `app/restaurants/[id]/reservations/actions.integration.test.ts` | table reservation lifecycle, deposit invoicing, double-booking guard | 8 |
| `app/sites/[id]/token-scope.integration.test.ts` | SecurityToken scope policy — manage vs orders gates (real DB) | 5 |
| `app/sites/[id]/rentals/actions.integration.test.ts` | deleteRentalItem active-booking guard, getRentalItems booking count | 5 |

### Mocking patterns

- Use `vi.mock()` with `vi.fn()` in factory (never reference external variables — hoisting), then `vi.mocked(importedFn)` after import for typed references
- Always call `mockAuth.mockResolvedValue(null)` in `beforeEach` — `vi.clearAllMocks()` clears call history but not implementations, so auth leaks between tests if not reset
- For env vars captured at module load time, use `vi.hoisted()`

## Key Patterns

- Site ownership: all mutations go through `requireSiteOwner()` or `verifySiteOwnership()` which check `session.user.id === site.userId` (sudo users bypass)
- Auto-save: debounced (1.5–2s) field changes trigger server actions → `revalidatePath` refreshes site context
- Manage page: token-gated (no auth, uses site-specific `accessKey` from SecurityToken table). All manage server actions accept optional `accessKey` parameter — validates token expiry and resource permissions (`'all'` or `'manage_site'`). Supports walk-in reservations, check-in/departure, bed blocking, hourly/daily rental operations
- Inventory: items have `status` (new/active/inactive), coordinates for map placement, optional pairing (double sunbeds). Parcels (grouped items) support drag-and-drop repositioning on the map — dragging any item in a group moves the entire parcel via `moveParcel()` server action. Physical sunbed size: 2.1m (must match `getScaledSize()` in InventoryMap, InventoryField, and `generateChairs()` in chair-util)
- Equipment rentals: `RentalItem` supports `pricePerHour` and `pricePerDay`. Walk-in rentals via `CreateRentalModal` with quick-pick duration (1h, 2h, 3h, all day). `RentalBookingCard` shows time range and overdue status for hourly bookings
- Image upload: Vercel Blob `put()` in server actions; remote patterns whitelisted in `next.config.mjs`
- UI / design system: see **`apps/partner/UI.md`** (partner design-system layer) + the general **`.claude/rules/ui.md`**; prime UI work with `/ui partner`.
