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
| `/sites/[id]/orders` | Real-time order dashboard — live polling, complete/discard actions; table chip shown for dine-in tab rounds (`Order.tableId`) | Public |
| `/sites/[id]/manage` | On-site management — token-gated landing (links to sub-routes) | Public |
| `/sites/[id]/manage/sunbeds` | Sunbed grid — token-gated, walk-ins, check-in/departure, rentals | Public |
| `/sites/[id]/manage/summary` | Daily summary — admin-token-only, per-employee till totals + close | Public |
| `/sites/[id]/manage/close` | Day close (cierre de caja) — admin-token-only, day totals + two-step closeDay | Public |
| `/sites/[id]/rentals` | Equipment rental item CRUD | Auth |
| `/calendar` | Monthly reservation calendar — site selector, day detail panel | Auth |
| `/account` | Partner account settings — personal info, company, billing (IBAN) | Auth |
| `/account/staff` | Staff roster — per-account `Employee` CRUD (current-worker chip source) | Auth |
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
- **`restaurants/[id]/queries.ts`**: `getRestaurant`, `getRestaurantLayout`, `getRestaurantMenu`, `getRestaurantShifts`, `getRestaurantCombinations`, `getRestaurantWaitlist`, `getTablesList` (active tables for dine-in QR printing)
- **`sites/[id]/manage/actions.ts`**: `reserveItem`, `unreserveItem`, `checkInReservation`, `resumeWalkIn`, `undoDepartWalkIn` (same-day depart undo — server action only; floor surface via the Guests sheet pending, track 018), `markDeparted`, `markNoShow`, `updateReservationNotes`, `moveReservation`, `blockBed`, `unblockBed`, `holdBed`, `compBed`, `convertHoldToWalkIn`, `markRentalPickedUp`, `markRentalReturned`, `createWalkInRental`, `collectReservationPayment`/`getCollectStatus`/`cancelCollection` (QR collect), `getTillStatus`/`closeTill` (per-worker till) (all token-or-session). On-site create actions take an optional trailing `employeeId` (current-worker attribution), validated against the account via `resolveEmployeeId`; cash walk-ins record `paymentAmount` for the till. **Reservation state transitions delegate to the state machine** (`@repo/data/reservation-machine-apply` — track 018): guards, day-row atomicity, till partitioning, credit notes, and refund-vs-delete are table-driven; actions name events and map outcomes (same for `frontdesk/actions.ts` and `reservations/[id]/actions.ts`).
- **`sites/[id]/rentals/actions.ts`**: `getRentalItems`, `createRentalItem`, `updateRentalItem`, `deleteRentalItem`, `toggleSiteFeature`
- **`sites/[id]/accounting/actions.ts`**: `getPaidItemsByMonth` (returns `{ orders, reservations, tabs }` — dine-in tab PARTNER invoices via `tableTabId` now included in `tabs`), `getInvoicesByMonth`, `getRevenueTrend`/`getOccupancyTrend`/`getRevenueCsv` (track 007 analytics), `getStaffTill` (per-employee monthly cash breakdown) — session + site-owner
- **`account/staff/actions.ts`**: `getEmployees`, `createEmployee`, `renameEmployee`, `setEmployeeActive`, `deleteEmployee` — per-account `Employee` roster (session-scoped, `accountId === session.user.id`)
- **`security/actions.ts`**: `getTokens`, `getOwnedSites`, `createToken`, `deleteToken` — SecurityToken (access-key) management (session-scoped)

## State Management

Redux slices: `reservationsSlice` (key-value store). RTK Query (`apiSlice`): `getReservations`, `getReservationsByDay`, `getReservationsByMonth`. Context: `SiteContext` provides `site`, `setSite`, `apiKey`, `nonce` to site sub-routes.

## Testing

```bash
npm run test              # unit tests (1981 tests across 53 files, Prisma mocked)
npm run test:watch        # vitest in watch mode
npm run test:coverage     # unit tests with Istanbul coverage report
npm run test:integration  # integration tests (206 tests across 10 files, real sunbnb_test DB)
```

### Test architecture spine

The test suite includes four meta-guards that enforce architecture invariants:

- **`app/test/auth-matrix.test.ts`** (669 tests) — Drives every action in the gated-action registry (`app/test/gated-actions.ts`) through all auth scenarios (no session, wrong owner, token-only, sudo). The single source of truth for "which actions exist and which gates they must respect."
- **`app/test/coverage-contract.test.ts`** (4 tests) — Fails if the gated-action registry omits an exported server action that has an auth gate in its source. Prevents new actions from silently skipping the matrix.
- **`app/test/mock-contract.test.ts`** (17 tests) — Verifies that the `@repo/data` mock modules expose every export from the real source packages. Prevents silent mock drift (new real export never added to mock → tests silently skip code paths).
- **`app/test/no-inline-money.test.ts`** (2 tests) — Rejects hardcoded monetary literals (`0.XX`, `XX.00`) in server-action source files; enforces use of DB-fetched prices.

### Unit tests (`vitest.config.ts`)

Path aliases redirect `@repo/data/PrismaCient` → mock, `@repo/data/password-reset` → mock, `@repo/data/rate-limit` → mock, `@repo/data/subscription` → mock.

Mock modules (`__mocks__/@repo/data/`): `PrismaCient.ts`, `password-reset.ts`, `rate-limit.ts`, `subscription.ts`, `reservation-emails.ts`.

| File | What it tests | Tests |
|---|---|---|
| `lib/validation.test.ts` | validateImageFile, validatePassword, enum validators | 45 |
| `app/sites/[id]/site-actions.test.ts` | saveGeneral, submitForm, deleteSite, setSiteStatus, setPaymentProvider, checkSlug, saveBrand | 37 |
| `app/sites/[id]/inventory-actions.test.ts` | CRUD, auto-increment, ownership, cross-site pair validation | 28 |
| `app/sites/[id]/inventory/actions.test.ts` | schematic/pool seat inventory actions; pool-sentinel exclusion from parcel geometry + centroid-shift guard (rotation-teleport regression); P4 set-based write contracts (moveParcel/moveItems raw SQL, createMany, NaN-delta guards) | 64 |
| `app/sites/[id]/schematic/actions.test.ts` | schematic layout actions | 16 |
| `app/sites/[id]/products/actions.test.ts` | toggleAppSales, setOrderPaymentType, updateProduct VAT recalc, soft-delete, soldOut | 30 |
| `app/sites/[id]/orders/actions.test.ts` | order status transitions (complete→accepted→preparing→ready→delivered), rejection, discard | 19 |
| `app/sites/[id]/manage/actions.test.ts` | manage actions — creates (walk-in/hold/comp/block), machine-DELEGATION contracts for migrated transitions (which event, which subset, outcome mapping; behavior lives in @repo/data machine tests + the matrix), collect delegation, rental ops, till | 362 |
| `app/sites/[id]/manage/grid-helpers.test.ts` | manage grid layout and seat ordering helpers | 28 |
| `app/sites/[id]/manage/bed-state.test.ts` | grid presentation over the machine's deriveState (BedState mapping, release rule, payment glyph, freed-seat share + bulk refund partitions) | 41 |
| `app/frontdesk/actions.test.ts` | frontdesk search + machine-delegation contracts (checkIn/depart/noShow/cancel) + rental ops | 47 |
| `app/reservations/[id]/actions.test.ts` | reservation-detail machine-delegation contracts + notes | 22 |
| `app/sites/[id]/rentals/actions.test.ts` | getRentalItems, createRentalItem, updateRentalItem, deleteRentalItem, toggleSiteFeature | 46 |
| `app/sites/[id]/working-hours-actions.test.ts` | addWorkingHours, deleteWorkingHours, overlap validation | 21 |
| `app/sites/[id]/queries.test.ts` | getSite query | 3 |
| `app/restaurants/[id]/queries.test.ts` | getRestaurant, getRestaurantLayout, getRestaurantMenu, getRestaurantShifts, getRestaurantCombinations, getRestaurantWaitlist, getTablesList | 28 |
| `app/sites/create/actions.test.ts` | site creation wizard actions | 6 |
| `app/calendar/actions.test.ts` | createPartnerReservation (auth, availability, double-booking, paired items), getAvailableSunbeds | 12 |
| `app/restaurants/[id]/actions.test.ts` | restaurant CRUD, settings | 20 |
| `app/restaurants/[id]/actions.shifts-and-duplicate.test.ts` | shift management and duplicate-opening guard | 15 |
| `app/restaurants/[id]/menu/actions.test.ts` | menu item CRUD | 9 |
| `app/restaurants/[id]/tables/actions.test.ts` | table CRUD and combination management | 13 |
| `app/restaurants/[id]/reservations/actions.test.ts` | table reservation lifecycle | 20 |
| `app/restaurants/[id]/orders/actions.test.ts` | restaurant-scoped kitchen dashboard (transitions, ownership, settle-cash, discard, token auth) | 21 |
| `app/restaurants/[id]/accounting/actions.test.ts` | getRestaurantTabInvoicesByMonth (auth, month-window query scoping) | 5 |
| `app/api/reservations-cleanup/route.test.ts` | cron auth, stale reservation cleanup | 5 |
| `app/api/subscription/webhook/route.test.ts` | Stripe signature verification, subscription events, status mapping | 7 |
| `app/api/auth/forgot-password/route.test.ts` | rate limiting, email validation, enumeration protection | 7 |
| `app/api/auth/reset-password/route.test.ts` | rate limiting, token/password validation | 7 |
| `app/api/auth/impersonate/route.test.ts` | sudo impersonation start | 4 |
| `app/api/auth/end-impersonation/route.test.ts` | impersonation end | 4 |
| `app/api/onboarding-status/route.test.ts` | Mollie onboarding status sync and caching | 7 |
| `app/api/reservations/[siteId]/route.test.ts` | ownership, date/month queries, HTTP status codes | 7 |
| `app/test/auth-matrix.test.ts` | auth gate matrix over all gated actions | 669 |
| `app/test/coverage-contract.test.ts` | gated-action registry completeness | 4 |
| `app/test/mock-contract.test.ts` | mock module superset of real exports | 17 |
| `app/test/no-inline-money.test.ts` | no hardcoded monetary literals in server actions | 2 |

### Integration tests (`vitest.integration.config.ts`)

Requires local Docker Postgres with `sunbnb_test` DB. No `@repo/data` mocks — all DB logic runs against real Postgres.

| File | What it tests | Tests |
|---|---|---|
| `app/sites/[id]/manage/actions.integration.test.ts` | reserveItem, checkIn, blockBed, splits (machine partition semantics), settled-unreserve row-kept, rental pickup/return, walk-in rental, till (real conflict guard) | 106 |
| `app/sites/[id]/manage/state-machine-matrix.integration.test.ts` | REAL actions driven through the machine's transition table (post-states from resolveTransition; formerly-RED bug-ledger cells B1a/b/c, D2, D10, D12 now green; COVERED/DEFERRED event manifest, shrink-only) | 19 |
| `app/frontdesk/actions.integration.test.ts` | frontdesk transitions against real DB | 5 |
| `app/calendar/actions.integration.test.ts` | createPartnerReservation (real DB writes, availability, cash payment) | 19 |
| `app/sites/[id]/orders/actions.integration.test.ts` | order status transitions and invoice creation against real DB | 13 |
| `app/sites/[id]/site-actions.integration.test.ts` | saveGeneral persists to DB, PostGIS coords, entitlement gate | 12 |
| `app/restaurants/[id]/reservations/actions.integration.test.ts` | table reservation lifecycle, deposit invoicing, double-booking guard | 8 |
| `app/sites/[id]/token-scope.integration.test.ts` | SecurityToken scope policy — manage vs orders gates (real DB) | 5 |
| `app/sites/[id]/rentals/actions.integration.test.ts` | deleteRentalItem active-booking guard, getRentalItems booking count | 5 |
| `app/sites/[id]/inventory/actions.integration.test.ts` | track 020 P4 batched writes against real Postgres: moveParcel exact set-based arithmetic (seats + anchor, pool untouched, NaN rejected), moveItems subset scope, createInventoryItem concurrent number minting (advisory lock), rearrange re-pairing across crossed legacy SunbedGroups (historical P2025 double-delete) — 3 of 6 verified to FAIL on the pre-P4 code | 6 |

### Mocking patterns

- Use `vi.mock()` with `vi.fn()` in factory (never reference external variables — hoisting), then `vi.mocked(importedFn)` after import for typed references
- Always call `mockAuth.mockResolvedValue(null)` in `beforeEach` — `vi.clearAllMocks()` clears call history but not implementations, so auth leaks between tests if not reset
- For env vars captured at module load time, use `vi.hoisted()`

## Key Patterns

- **Reservation state machine (track 018)**: transitions run through `applyTransition` (`@repo/data/reservation-machine-apply`); the grid derives state via the same `deriveState` (`bed-state.ts` is a presentation shell). A single-writer ratchet in `packages/data/src/reservation-machine-guard.test.ts` fails the build on any new direct reservation state write. Add transitions by editing the TABLE, not by writing guards in actions.
- Site ownership: all mutations go through `requireSiteOwner()` or `verifySiteOwnership()` which check `session.user.id === site.userId` (sudo users bypass)
- Auto-save: debounced (1.5–2s) field changes trigger server actions → `revalidatePath` refreshes site context
- Manage page: token-gated (no auth, uses site-specific `accessKey` from SecurityToken table). All manage server actions accept optional `accessKey` parameter — validates token expiry and resource permissions (`'all'` or `'manage_site'`). Supports walk-in reservations, check-in/departure, bed blocking, hourly/daily rental operations
- Floor-staff attribution & till (tracks 008/013/016): a per-`PartnerAccount` `Employee` roster (`/account/staff`) feeds a current-worker chip in `ManageToolbar` (localStorage `sunbnb-manage-worker-${site.id}`, server-fetched roster passed from `manage/page.tsx`). On-site create actions auto-stamp the chosen `employeeId` (no per-transaction input; cross-account/stale ids drop to null via `resolveEmployeeId`); cash walk-ins record `paymentAmount`. The till is **day-anchored** (track 016): every till action computes venue-local `dayStart` (`siteTodayBounds`) and the open till splits into `today` (since `max(lastClose, dayStart)`) + `carryOver` (unclosed cash from prior days, amber-surfaced) — a close sweeps both via the shared `closeEmployeeTill` writer (snapshot records `carryOverAmount`/`carryOverCount`). The worker's till (`getTillStatus`/`closeTill`, day-first "Today" lead + carry-over banner) lives in `TillSheet`; the admin daily summary (`/manage/summary`, `DailySummaryView.tsx`, admin-token-gated via `verifySiteAdmin`) leads with **daily accumulation** (`getTillDayReport` for today — close-independent) with "still uncounted / handed in today" reconciliation lines, per-worker drawers + itemized rows underneath; day close (`/manage/close`, `closeDay` → `closeAllOpenTills`, returns `carryOverClosed`) is cash-up-only. The manager's monthly per-worker cash roll-up (`getStaffTill` → `getTillByEmployee`, `EmployeeCashTotal[]`) is a card on the accounting page. Till aggregation in `@repo/data/till` (unit tests alias it to `__mocks__/@repo/data/till.ts`). Attribution is orthogonal to the `accessKey` gate.
- Inventory: items have `status` (new/active/inactive), coordinates for map placement, optional pairing (double sunbeds). Parcels (grouped items) support drag-and-drop repositioning on the map — dragging any item in a group moves the entire parcel via `moveParcel()` server action. Physical sunbed size: 2.1m (must match `getScaledSize()` in InventoryMap, InventoryField, and `generateChairs()` in chair-util)
- Equipment rentals: `RentalItem` supports `pricePerHour` and `pricePerDay`. Walk-in rentals via `CreateRentalModal` with quick-pick duration (1h, 2h, 3h, all day). `RentalBookingCard` shows time range and overdue status for hourly bookings
- Dine-in tab QR codes: `restaurants/[id]/tables/DineInQRButton.tsx` (client, jsPDF + qrcode) generates a PDF of per-table QR cards linking to `/tables/<tableId>` (dine-in v2 canonical route — table id is globally unique, no `siteId` needed); lives in `apps/partner` ONLY (the URL encodes `CONSUMER_APP_URL` from the server — not `@repo/table-reservations-ui`). Rendered whenever the restaurant has active tables — standalone and site-linked restaurants alike (`tables/page.tsx` fetches unconditionally). `Restaurant.dineInEnabled` (toggle on the restaurant General tab, `RestaurantSettingsForm`) is the actual dine-in ordering gate consumed by the `/tables/[tableId]` consumer route — printing a QR doesn't require it to be on. Orders dashboard shows a table chip (violet pill) when `Order.tableId` is set — `page.tsx` fetches the table map via `prisma.table.findMany` after orders are loaded. Restaurant-scoped kitchen dashboard: `/restaurants/[id]/orders` (token-or-session, `verifyRestaurantAccess`) mirrors the site orders dashboard via a shared `scope` prop on the `Orders` view (`sites/[id]/orders/view.tsx`); minimal restaurant accounting (`/restaurants/[id]/accounting`, session-only) shows dine-in tab invoices for the month, no charts.
- Image upload: Vercel Blob `put()` in server actions; remote patterns whitelisted in `next.config.mjs`
- UI / design system: see **`apps/partner/UI.md`** (partner design-system layer) + the general **`.claude/rules/ui.md`**; prime UI work with `/ui partner`.
