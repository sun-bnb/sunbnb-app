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
npm run test              # unit tests (159 tests, Prisma mocked)
npm run test:watch        # vitest in watch mode
npm run test:coverage     # unit tests with Istanbul coverage report
```

### Unit tests (`vitest.config.ts`)

- Path aliases redirect `@repo/data/PrismaCient` → mock, `@repo/data/password-reset` → mock, `@repo/data/rate-limit` → mock, `@repo/data/subscription` → mock
- **Mock modules** (`__mocks__/@repo/data/`): `PrismaCient.ts`, `password-reset.ts`, `rate-limit.ts`, `subscription.ts`, `reservation-emails.ts`
- `lib/validation.test.ts` — validateImageFile, validatePassword, enum validators (25 tests)
- `app/sites/[id]/site-actions.test.ts` — saveGeneral, submitForm, deleteSite, setSiteStatus, setPaymentProvider, checkSlug, saveBrand (25 tests)
- `app/sites/[id]/inventory-actions.test.ts` — CRUD, auto-increment, ownership checks (10 tests)
- `app/sites/[id]/products/actions.test.ts` — toggleAppSales, setOrderPaymentType, updateProduct VAT recalc, soft-delete, soldOut (13 tests)
- `app/sites/[id]/orders/actions.test.ts` — order status transitions (complete→accepted→preparing→ready→delivered), rejection, discard (13 tests)
- `app/sites/[id]/manage/actions.test.ts` — walk-in reserveItem, checkIn/departure/noShow state machine, moveReservation, blockBed, rental pickup/return, createWalkInRental availability (30 tests)
- `app/calendar/actions.test.ts` — createPartnerReservation (auth, availability, double-booking, paired items), getAvailableSunbeds (11 tests)
- `app/api/reservations-cleanup/route.test.ts` — cron auth, stale reservation cleanup (5 tests)
- `app/api/subscription/webhook/route.test.ts` — Stripe signature verification, subscription events, status mapping (7 tests)
- `app/api/auth/forgot-password/route.test.ts` — rate limiting, email validation, enumeration protection (7 tests)
- `app/api/auth/reset-password/route.test.ts` — rate limiting, token/password validation (7 tests)
- `app/api/reservations/[siteId]/route.test.ts` — ownership, date/month queries (6 tests)

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
