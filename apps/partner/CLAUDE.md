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
| `/sites/[id]/brand` | Brand customization — name, slug, tagline, colors; debounced auto-save via `saveBrand` (it DOES persist — the old "preview only, won't be saved" banner was false and is gone). **Follows the effective render** (track 023 D2): when a bespoke brand page is LIVE the tab states that instead of offering the tokens, and keeps only the slug — the address is not presentation, and a rename is safe because the brand registry keys on `customBrandKey`. The Business-plan gate is skipped for a bespoke site (platform-delivered work, not a plan entitlement — pitching an upgrade for a branded page they already have would also hide the slug control) | Auth |
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

- **`sites/[id]/site-actions.ts`**: `saveGeneral`, `submitForm`, `deleteSite`, `setSiteStatus`, `setPaymentProvider`, `setPartialGroupBooking` (the site's booking-granularity policy — see below), `saveBrand` (REJECTS token writes while a bespoke page is live — a hidden form still posts), `saveSlug` (the address alone, always allowed: splitting it out is what stops a token rejection taking the slug with it), `checkSlug`, `generateSlug`, `getBrand`
- **`sites/[id]/content-actions.ts`**: `saveContentFields`, `uploadContentImage`
- **`sites/[id]/inventory-actions.ts`**: `createInventoryItem`, `deleteInventoryItem`, `deleteInventoryItems` (bulk — one transaction + one label recompute), `saveInventoryItemLocation`, `saveInventoryItemProperties`, `deleteItemsByGroup`
- **`sites/[id]/working-hours-actions.ts`**: `addWorkingHours`, `deleteWorkingHours`
- **`sites/[id]/queries.ts`**: `getSite` (exported), `getInventoryItems` (scoped item refresh — merged client-side instead of a full-site re-download after rotate/spacing, track 020), `resolveServiceFees` (private helper). Companion PLAIN modules (not `'use server'` — a `'use server'` file may export async functions only): `item-select.ts` (`INVENTORY_ITEM_SELECT`, the shared narrow seat projection) and `item-counts.ts` (`getSiteItemCounts`, `todayReservationsWindow`)
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
npm run test              # unit tests (Prisma mocked)
npm run test:watch
npm run test:coverage
npm run test:integration  # real sunbnb_test DB
```

The suite has four **meta-guards** that enforce architecture invariants — auth matrix over every
gated action, gated-action registry completeness, mock-drift contract, and a no-inline-money check.
Adding a gated server action without registering it fails the build.

Full per-file inventory, the meta-guard detail and mocking patterns: **`apps/partner/TESTING.md`**.

## Key Patterns

- **Reservation state machine (track 018)**: transitions run through `applyTransition` (`@repo/data/reservation-machine-apply`); the grid derives state via the same `deriveState` (`bed-state.ts` is a presentation shell). A single-writer ratchet in `packages/data/src/reservation-machine-guard.test.ts` fails the build on any new direct reservation state write. Add transitions by editing the TABLE, not by writing guards in actions.
- **Site codes** (track 022): every site carries `Site.code` (`S-` + 6 Crockford symbols) — the site half of the printed QR URL (`/q/S-K7M2X9/1-1-1`). **Both** creation paths (the `sites/create` wizard and `site-actions.ts` `submitForm`) go through `lib/site-create.ts` `createSiteWithCode`, which mints inside a retry loop and rethrows anything that is not a `code` collision. Existing rows: `npm run backfill:site-codes:*` in `packages/data`. Format rules live in `@repo/data/site-code`. **The printed QR card carries the short URL** — `inventory/qr-url.ts` `qrCardUrl` builds `{appUrl}/q/{code}/{parcel}-{row}-{seq}` by unpacking the item's `seatLabel` (no extra payload — the label already carries the address), and **falls back to the legacy long URL** when the site has no code or the seat no label, rather than refusing to print: the legacy URL redirects to the short form as soon as both halves exist. The QR names the UNIT; the card's visible label still names the BED, so a pair's two cards differ on the page and share a target.
- Site ownership: all mutations go through `requireSiteOwner()` or `verifySiteOwnership()` which check `session.user.id === site.userId` (sudo users bypass)
- Auto-save: debounced (1.5–2s) field changes trigger server actions → `revalidatePath` refreshes site context
- Manage page: token-gated (no auth, uses site-specific `accessKey` from SecurityToken table). All manage server actions accept optional `accessKey` parameter — validates token expiry and resource permissions (`'all'` or `'manage_site'`). Supports walk-in reservations, check-in/departure, bed blocking, hourly/daily rental operations
- Floor-staff attribution & till (tracks 008/013/016): a per-`PartnerAccount` `Employee` roster (`/account/staff`) feeds a current-worker chip in `ManageToolbar` (localStorage `sunbnb-manage-worker-${site.id}`, server-fetched roster passed from `manage/page.tsx`). On-site create actions auto-stamp the chosen `employeeId` (no per-transaction input; cross-account/stale ids drop to null via `resolveEmployeeId`); cash walk-ins record `paymentAmount`. The till is **day-anchored** (track 016): every till action computes venue-local `dayStart` (`siteTodayBounds`) and the open till splits into `today` (since `max(lastClose, dayStart)`) + `carryOver` (unclosed cash from prior days, amber-surfaced) — a close sweeps both via the shared `closeEmployeeTill` writer (snapshot records `carryOverAmount`/`carryOverCount`). The worker's till (`getTillStatus`/`closeTill`, day-first "Today" lead + carry-over banner) lives in `TillSheet`; the admin daily summary (`/manage/summary`, `DailySummaryView.tsx`, admin-token-gated via `verifySiteAdmin`) leads with **daily accumulation** (`getTillDayReport` for today — close-independent) with "still uncounted / handed in today" reconciliation lines, per-worker drawers + itemized rows underneath; day close (`/manage/close`, `closeDay` → `closeAllOpenTills`, returns `carryOverClosed`) is cash-up-only. The manager's monthly per-worker cash roll-up (`getStaffTill` → `getTillByEmployee`, `EmployeeCashTotal[]`) is a card on the accounting page. Till aggregation in `@repo/data/till` (unit tests alias it to `__mocks__/@repo/data/till.ts`). Attribution is orthogonal to the `accessKey` gate.
- Inventory: items have `status` (new/active/inactive), coordinates for map placement, optional pairing (double sunbeds). Parcels (grouped items) support drag-and-drop repositioning on the map — dragging any item in a group moves the entire parcel via `moveParcel()` server action. Physical sunbed size: 2.1m (must match `getScaledSize()` in InventoryMap, InventoryField, and `generateChairs()` in chair-util)
- **Seat ids** (track 021): every surface that shows a seat renders `{parcel}-{row}-{seq}-{member}` (`1-1-1-2`) via `formatSeatId` (`@repo/data/seat-label`), which UNPACKS the stored `seatLabel` — inventory editor, schematic canvas, manage grid + bed detail, and the QR cards — storage packs row and unit ordinal into one segment (`1-101-2`), hiding the unit address that a device is assigned to. **Display only**: `seatLabel` is untouched, so devices still resolve as before. Applies to the printed QR cards too (`qr-print-button.tsx`) — those are the one place a label leaves the screen and lands on a bed, so cards printed before this change show the old packed form and should be reprinted if both are in circulation. Parsing rather than shipping the unit's `parcel`/`row`/`seq` columns keeps the C2 payload cut intact (the label already carries all four numbers). Pinned by a test that unpacks every generated label back to the independently-computed unit address, so the id on screen and the address a device answers for cannot drift.
- **Partial group booking**: `Site.partialGroupBookingEnabled` (General tab → "Reservation rules", off by default, `setPartialGroupBooking`) decides whether a guest may book PART of a sunbed unit or only whole units. A dedicated column rather than a `features[]` entry — `features` says what a site SELLS, this is a booking policy. Consumed by the user app's seat selection (`apps/user/app/sites/[id]/seat-selection.ts`); the venue (manage grid) and POS flows do not read it yet.
- Equipment rentals: `RentalItem` supports `pricePerHour` and `pricePerDay`. Walk-in rentals via `CreateRentalModal` with quick-pick duration (1h, 2h, 3h, all day). `RentalBookingCard` shows time range and overdue status for hourly bookings
- Dine-in tab QR codes: `restaurants/[id]/tables/DineInQRButton.tsx` (client, jsPDF + qrcode) generates a PDF of per-table QR cards linking to `/tables/<tableId>` (dine-in v2 canonical route — table id is globally unique, no `siteId` needed); lives in `apps/partner` ONLY (the URL encodes `CONSUMER_APP_URL` from the server — not `@repo/table-reservations-ui`). Rendered whenever the restaurant has active tables — standalone and site-linked restaurants alike (`tables/page.tsx` fetches unconditionally). `Restaurant.dineInEnabled` (toggle on the restaurant General tab, `RestaurantSettingsForm`) is the actual dine-in ordering gate consumed by the `/tables/[tableId]` consumer route — printing a QR doesn't require it to be on. Orders dashboard shows a table chip (violet pill) when `Order.tableId` is set — `page.tsx` fetches the table map via `prisma.table.findMany` after orders are loaded. Restaurant-scoped kitchen dashboard: `/restaurants/[id]/orders` (token-or-session, `verifyRestaurantAccess`) mirrors the site orders dashboard via a shared `scope` prop on the `Orders` view (`sites/[id]/orders/view.tsx`); minimal restaurant accounting (`/restaurants/[id]/accounting`, session-only) shows dine-in tab invoices for the month, no charts.
- **Site payload tiering (track 020 C2)**: `site-page.tsx` wraps all eight site tabs, but only the two EDITOR tabs (`inventory`, `schematic`) receive seat rows — everything else gets `inventoryItems: []` plus the server-computed scalars `itemCount` / `activeItemCount` / `availableTodayCount` (`getSiteItemCounts`), which the brand stats and the readiness checklist read (array fallbacks retained). Editor rows use the shared narrow `INVENTORY_ITEM_SELECT` — no `notes`/`image`/`userId`/timestamps, and `pair`/`pairedBy` as `{ id }` stubs, not whole rows. `getSite` and `getInventoryItems` project the SAME shape (pinned by a merge-compatibility test) because the scoped refresh merges rows into the context by id. Measured on the 4,436-item dev site: inventory RSC 5,487KB → 2,117KB, count-only tabs → 83KB.
- **Inventory editor parcel tier (track 020 C2 slice 2)**: the inventory tab payload carries `ParcelSummary` rows (`parcels.ts` → `getParcelSummaries`: per-parcel seat count + the ItemGroup geometry `parcelFootprint` needs) **plus only the ungrouped seats** — a grouped seat is not shipped until its parcel is opened or scrolls into the seat-zoom viewport, when `getItemsByGroups` streams it and it is merged into the SAME site context (so every existing `inventory`-reading consumer is unchanged; a parcel is simply absent until loaded). Overview boxes are drawn from summary geometry; a summary box drag targets the **ItemGroup anchor** (`moveParcel` without an anchor item) since no seat exists client-side. Aggregates (header totals, parcel-bar chip counts, complete-parcel checks, next parcel number) read summaries via `parcelSeatCount` — reading them off the loaded array renders `(0)`, a regression only the browser caught. `SiteContext.setSite` accepts an updater because seat loads can overlap. Measured on the 4,436-item dev site: inventory RSC **5,487KB → 87KB**.
- Image upload: Vercel Blob `put()` in server actions; remote patterns whitelisted in `next.config.mjs`
- UI / design system: see **`apps/partner/UI.md`** (partner design-system layer) + the general **`.claude/rules/ui.md`**; prime UI work with `/ui partner`.
