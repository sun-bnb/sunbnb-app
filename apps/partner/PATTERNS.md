# Partner App — surface patterns (pulled)

Pulled on demand; **not** auto-loaded. Partner-only patterns the wiki does not cover yet. The
always-loaded index is `apps/partner/CLAUDE.md` § Key Patterns; cross-app concepts live in the wiki
(`.claude/wiki/index.md`).

## Site codes and the printed QR (track 022)

- Every site carries `Site.code` (`S-` + 6 Crockford symbols) — the site half of the printed QR
  URL (`/q/S-K7M2X9/1-1-1`). Format rules: `@repo/data/site-code`.
- **Both** creation paths (the `sites/create` wizard and `site-actions.ts` `submitForm`) go through
  `lib/site-create.ts` `createSiteWithCode`, which mints inside a retry loop and rethrows anything
  that is not a `code` collision. Existing rows: `npm run backfill:site-codes:*` in `packages/data`.
- **The printed card carries the short URL**: `inventory/qr-url.ts` `qrCardUrl` builds
  `{appUrl}/q/{code}/{parcel}-{row}-{seq}` by unpacking the item's `seatLabel` (no extra payload).
- It **falls back to the legacy long URL** when the site has no code or the seat no label, rather
  than refusing to print — the legacy URL redirects to the short form once both halves exist.
- The QR names the UNIT; the card's visible label still names the BED, so a pair's two cards differ
  on the page and share a target.

## Seat ids (track 021)

- Every surface that shows a seat renders `{parcel}-{row}-{seq}-{member}` (`1-1-1-2`) via
  `formatSeatId` (`@repo/data/seat-label`), which UNPACKS the stored `seatLabel`.
- Surfaces: inventory editor, schematic canvas, manage grid + bed detail, QR cards
  (`qr-print-button.tsx`).
- Storage packs row and unit ordinal into one segment (`1-101-2`), hiding the unit address a device
  is assigned to. **Display only**: `seatLabel` is untouched, so devices resolve as before.
- QR cards printed before this change show the old packed form — reprint if both circulate.
- Parsing (rather than shipping the unit's `parcel`/`row`/`seq` columns) keeps the C2 payload cut.
- Pinned by a test that unpacks every generated label back to the independently-computed unit
  address, so the on-screen id and the device address cannot drift.

## Site payload tiering (track 020 C2)

- `site-page.tsx` wraps all eight site tabs, but only the two EDITOR tabs (`inventory`,
  `schematic`) receive seat rows.
- Every other tab gets `inventoryItems: []` plus server-computed scalars `itemCount` /
  `activeItemCount` / `availableTodayCount` (`getSiteItemCounts`), read by the brand stats and the
  readiness checklist (array fallbacks retained).
- Editor rows use the shared narrow `INVENTORY_ITEM_SELECT` — no `notes`/`image`/`userId`/timestamps;
  `pair`/`pairedBy` as `{ id }` stubs.
- `getSite` and `getInventoryItems` project the SAME shape (pinned by a merge-compatibility test)
  because the scoped refresh merges rows into the context by id.
- Measured on the 4,436-item dev site: inventory RSC 5,487 KB → 2,117 KB, count-only tabs → 83 KB.

## Inventory editor parcel tier (track 020 C2 slice 2)

- The inventory tab ships `ParcelSummary` rows (`parcels.ts` → `getParcelSummaries`: per-parcel
  seat count + the ItemGroup geometry `parcelFootprint` needs) **plus only the ungrouped seats**.
- A grouped seat ships only when its parcel is opened or scrolls into the seat-zoom viewport:
  `getItemsByGroups` streams it and it merges into the SAME site context (existing consumers
  unchanged; an unloaded parcel is simply absent).
- Overview boxes are drawn from summary geometry; a summary box drag targets the **ItemGroup
  anchor** (`moveParcel` without an anchor item) since no seat exists client-side.
- Aggregates (header totals, parcel-bar chip counts, complete-parcel checks, next parcel number)
  read summaries via `parcelSeatCount` — reading the loaded array renders `(0)` (a regression only
  the browser caught).
- `SiteContext.setSite` accepts an updater because seat loads can overlap.
- Measured on the 4,436-item dev site: inventory RSC **5,487 KB → 87 KB**.

## Inventory mutations and revalidation (track 020)

- Bulk ops in `sites/[id]/inventory/actions.ts` — `moveParcel`, `moveItems`, `rotateSelection`,
  `adjustItemSpacing`, `reverseParcelNumbering`, `reverseParcelOrientation` — do **not**
  `revalidatePath`.
- They rely on the client's scoped `refreshItems(itemIds)` (`inventory/view.tsx`, over
  `getInventoryItems`) instead of a full-site re-download.
- `syncChairsWithLayout` (same file), `inventory-actions.ts` and `inventory/parcel-ops.ts` DO
  `revalidatePath('/sites')`. A new action picks one deliberately.
- Items have `status` (new/active/inactive), map coordinates, optional pairing (double sunbeds);
  dragging any item in a group moves the whole parcel via `moveParcel()`.
- Physical sunbed size 2.1 m — must match `getScaledSize()` in InventoryMap, InventoryField, and
  `generateChairs()` in chair-util.

## Brand tab (`/sites/[id]/brand`, track 023 D2)

- Debounced auto-save via `saveBrand` (it DOES persist — the old "preview only" banner was false).
- **Follows the effective render**: when a bespoke brand page is LIVE the tab says so instead of
  offering tokens, and keeps only the slug.
- A slug rename is safe because the brand registry keys on `customBrandKey`. `saveBrand` REJECTS
  token writes while a bespoke page is live; `saveSlug` (address alone) is always allowed.
- The Business-plan gate is skipped for a bespoke site (platform-delivered work, not a plan
  entitlement; gating would also hide the slug control).

## Partial group booking

`Site.partialGroupBookingEnabled` (General tab → "Reservation rules", off by default,
`setPartialGroupBooking`) decides whether a guest may book PART of a sunbed unit. A dedicated
column, not a `features[]` entry — `features` says what a site SELLS, this is a booking policy.
Consumed by the user app's seat selection (`apps/user/app/sites/[id]/seat-selection.ts`); the manage
grid and POS flows do not read it yet.

## Dine-in table QR (partner side)

- `restaurants/[id]/tables/DineInQRButton.tsx` (client, jsPDF + qrcode) prints per-table cards
  linking to `/tables/<tableId>` (table id is globally unique, no `siteId`).
- Lives in `apps/partner` ONLY — the URL encodes `CONSUMER_APP_URL` from the server, so not in
  `@repo/table-reservations-ui`.
- Rendered whenever the restaurant has active tables (`tables/page.tsx` fetches unconditionally);
  printing does not require `Restaurant.dineInEnabled` (the ordering gate).
- Orders dashboard shows a violet table chip when `Order.tableId` is set (`page.tsx` loads the table
  map via `prisma.table.findMany` after orders).
- Kitchen `/restaurants/[id]/orders` (token-or-session, `verifyRestaurantAccess`) reuses the site
  `Orders` view via a `scope` prop; `/restaurants/[id]/accounting` (session) lists month tab invoices.
- Canon: `.claude/wiki/subsystems/table-reservations.md`, `.claude/wiki/entities/restaurant.md`.

## Rentals UI

`RentalItem` has `pricePerHour` and `pricePerDay`. Walk-in rentals via `CreateRentalModal`
(quick-pick 1h, 2h, 3h, all day); `RentalBookingCard` shows the time range and overdue status for
hourly bookings. Flow: `.claude/wiki/flows/rental-booking.md`.
