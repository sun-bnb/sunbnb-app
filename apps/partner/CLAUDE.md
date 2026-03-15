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

## Key Patterns

- Site ownership: all mutations go through `requireSiteOwner()` or `verifySiteOwnership()` which check `session.user.id === site.userId` (sudo users bypass)
- Auto-save: debounced (1.5–2s) field changes trigger server actions → `revalidatePath` refreshes site context
- Manage page: token-gated (no auth, uses site-specific nonce), supports walk-in reservations, check-in/departure, bed blocking, rental operations
- Inventory: items have `status` (new/active/inactive), coordinates for map placement, optional pairing (double sunbeds)
- Image upload: Vercel Blob `put()` in server actions; remote patterns whitelisted in `next.config.mjs`
- Styling: MUI + Tailwind coexist — progressive migration toward pure Tailwind
