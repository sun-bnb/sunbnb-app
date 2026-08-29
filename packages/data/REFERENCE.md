# Schema reference — `@repo/data`

Pulled on demand; **not** auto-loaded. The always-loaded summary is in
`packages/data/CLAUDE.md` § Schema. Read this when working on the schema, a migration, or a model
whose history matters (why a column exists, what replaced it, what is mid-retirement).

---

## Schema

Prisma schema at `packages/data/prisma/schema.prisma`. 70+ migrations. Uses `@prisma/adapter-pg` driver adapter. PostGIS extension for spatial queries (`geometry` type with GiST index).

Key models: User, PartnerAccount, Site, InventoryItem, Reservation, Order, OrderItem, RentalItem, RentalBooking, Invoice, InvoiceLine, Settlement, ServiceFee, Settings, PasswordResetToken, Product.

**`Device`** (track 019 P2 / 021) — the parasol-mounted HW devices served by the user app's `/api/hw/{code}/*`. `Device.code` is a PUBLIC 6-char Crockford-base32 identifier printed on the device's sticker; there is deliberately **no token/secret column** (Q9 — the endpoint is gated by a soft `User-Agent` client filter, not auth, because the data behind it is public occupancy). A device is placed by an **assigned ADDRESS** (`assignedSiteId`/`assignedParcel`/`assignedRow`/`assignedSeq`) set in the partner fleet UI, and answers for whatever unit occupies that address today — so a parcel rebuilt at the same spot needs no re-assignment. `status`: `provisioned → active → retired`.

**`DeviceSeat` is GONE** (dropped 2026-08-17). It bound a device to specific seat rows before resolution moved to addresses; nothing read it, and nothing held a foreign key to it, so the table drop was a single safe contract step.

**`InventoryItem.pairId` is retiring in three steps** (track 021). It is fully redundant with `SunbedGroup` — every row carrying one points at a seat in its OWN unit (2,251/2,251 dev, 216/216 test), and nothing reads it. Step 1 (done) dropped the FOREIGN KEY only, which is what the `updateMany({ pairId: null })` sweeps in the delete paths existed to protect against. Step 2 removes those sweeps and the remaining `pairId: null` writes in a code release. Step 3 drops the unique index and the column. The column cannot go earlier because `main` and `test` share one database and the branch that is behind still writes the field.

**`SunbedGroup` address** (track 021) — `parcel` + `row` (column `row_idx`; `ROW` is reserved and the inventory editor writes raw SQL) complete the unit's address alongside `seq`, under `@@unique([siteId, parcel, row, seq])`. Before this, parcel lived on `InventoryItem.group` and row was decoded out of `InventoryItem.number`, so two-thirds of a unit's address sat on its members — unconstrainable (no unique index spans two tables), resolvable only by fetching a parcel and filtering in JS, and silently re-pointable by a seat renumber. Derived from **placed seats only**: a `pool` extra carries a `nextPoolNumber` value decoding to a different row, so counting it relocates the unit. **`recomputeSeatLabels` is the only writer** — units are created bare everywhere and get their address there. A unit whose placed seats disagree (mid-rearrange) keeps its stored address rather than being given a guess; one with no placed seats surrenders it, so it cannot block the index against a real unit built on that spot later. Backfill: `npm run backfill:addresses:{local,test,production}[:dry]`, which verifies itself in raw SQL and fails if any address disagrees with the data or any `seq` moved.

**`Site.code`** (track 022) — the site's stable EXTERNAL identifier, `S-` + 6 Crockford
symbols, and the site half of the printed QR URL (`/q/S-K7M2X9/1-1-1`). Nullable during
expand, `@unique`, backfilled. Rules in `src/site-code.ts`; never rewritten once assigned.

**`Site.customBrandKey`** (track 023) — WHICH bespoke module renders this site (`reference`,
`alcudia`…). Not `Site.code` and not the slug: the code is minted per DATABASE, so the same
venue has different ones in dev/test/production and a committed registry keyed on one would
resolve nowhere else (including the Vercel previews that run on the test DB); the slug is
partner-editable. The key lives in code, each environment's row points at it, and one module
can serve a chain of sites.

**`src/brand-manifest.ts`** — pure, client-safe: `BRAND_KEYS` (every module in
`apps/user/brands`), `isKnownBrandKey`, and `resolveBrandRender(site) → { mode, key, reason }`,
the ONE answer to "what does a guest see" shared by the user app (which page), the partner brand
tab (whether the token editor is still in effect) and the admin fleet list (*live* vs *awaiting
code* vs *unknown key*). Both gates must pass; everything else resolves to the standard page,
because a bespoke page that is missing, misconfigured or switched off must cost the customer
their design and never their bookings. The React modules cannot live here — they are in
`apps/user` — so the LIST lives here and a test pins the two together.

**`Site.customBrandEnabled`** (track 023) — this site renders a BESPOKE brand page (a per-site
React module in `apps/user/brands`) instead of the standard `/s/{slug}` one. Admin-only. One of
TWO gates: the registry answers "does a bespoke page exist", this column answers "is it live",
so a merged page can sit dark and a broken one can be pulled without a deploy. On with no module
falls back to the standard page by design.

**`PlatformPreference`** — one global tunable per row (`key` → text `value`), the value
sibling of `FeatureFlag`: flags answer "does this feature exist yet", preferences answer
"with what value does it run". A row is only ever an OVERRIDE — which keys exist, their
type, bounds and default live in the `PREFERENCE_REGISTRY` in `src/preferences.ts`, so a
key dropped from the registry is inert rather than load-bearing, and a database that has
never been written to still produces the value the code was written against. Text `value`
parsed per the entry's type: one table serves every future setting with no migration per
setting.

**`src/unit-address.ts`** — pure (no prisma), the shared way to ask for a unit BY address: `unitAddressWhere` (a `findUnique` key on `UNIQUE(site_id, parcel, row_idx, seq)`), `SEGMENT_SEATS` (everything but `pool` spares), `formatUnitLocation` and its inverse `parseUnitAddress` (track 022 — reads `1-1-1` back out of a printed QR URL, and accepts the four-segment seat id `1-1-1-2` as the same unit; **syntax only, not domain bounds** — parcel 0 / row 0 are live addresses in real data, so it validates the shape and lets the DB say what exists, capping at int4 so a mistyped URL 404s instead of 500ing). Shared deliberately: a device's position is read by three parties that must agree — the HW state route serving it, the partner action assigning it, and `devicesBlockingSeatRemoval` refusing to delete the seats under it. Each used to re-derive the address itself, which is how a device, the UI that assigned it and the guard protecting it could hold three different opinions about where it was.

