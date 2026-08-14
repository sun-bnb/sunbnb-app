---
id: 020-large-venue-scale
title: Large-venue scale — dozens of parcels, thousands of sunbeds
status: active
created: 2026-08-13
updated: 2026-08-14
worktree: null
---

## Goal

Make a **single site with dozens of parcels and thousands of sunbeds** a supported
configuration. Today it is not: the read paths, render paths, and indexes are built around
the ~50–200-seat venues we actually have, and they degrade **super-linearly** past that.

The largest bed count referenced anywhere in the repo is **180** (`.claude/alonso/model/
sync-protocol.md:88`, the competitor's whole-map socket emit). No doc states a typical or
maximum site size, and there is **no cap anywhere** on parcel or inventory size —
`syncChairsWithLayout` validates only `rows >= 1` (`inventory/actions.ts:31-36`).

Nothing here is an architecture error. The domain model (site → parcel → seat, m2m
reservation↔item) carries the load fine. The problem is three habits repeated across every
surface:

1. **Unfiltered site-wide loads** — fetch every item, then narrow in JS.
2. **Zero memoization** — `useMemo`/`React.memo` count is literally **0** in
   `InventoryMap.tsx`, `SunbedMarker.tsx`, `manage/view.tsx`, `ParcelView.tsx`,
   `SunbedSelection.tsx`, `SchematicRenderer.tsx`.
3. **One DB statement per row** — `Promise.all(items.map(update))` where set-based SQL belongs.

End state: a 3 000-seat venue loads, renders, books, and is edited without the operator or
the guest noticing it is large; and one big tenant no longer degrades every other tenant.

**Estimated current envelope** (engineering judgment — *not measured*, see P0):

| Seats | Behavior |
|---|---|
| ~200 | Fine everywhere. The tested envelope. |
| ~500 | Inventory editor + schematic canvas laggy on pan/drag; availability still sub-second. |
| ~1 000 | Editor unusable while dragging; availability into seconds; manage poll stacks writes. |
| ~3 000 | Not functional. |

## Resume here

- **P0 + P1 are DONE and green** (2026-08-14, uncommitted on local `main`). Measured results
  live in **[`020-scale-baseline.md`](020-scale-baseline.md)** — read that before touching any
  later phase; it also records two index candidates measured and **rejected**, so they are not
  re-proposed.
- **Next action — USER OPS FIRST, then P3.**
  1. **`npm run migrate:test`** before any `main` push. Migration
     `20260814065600_add_site_scoped_indexes` is applied to local + `sunbnb_test` only. The
     shared test DB must satisfy main's preview the moment the code lands; the `.githooks/
     pre-push` hook blocks the push otherwise. Additive → expand phase → goes ahead of `main`.
  2. Then **P3** (render quadratics) is the highest value-per-risk remaining: pure client-side,
     no schema, no contract change. P2 (set-based availability) is higher value but rewrites a
     money-adjacent correctness path, so it wants its own careful slice.
- **Do NOT re-run the P0 seeder against anything but `sunbnb_scale`** — it TRUNCATEs. The guard
  refuses `sunbnb_test` and every remote host even with `--force`; leave that guard alone.
- **Context needed:** this file; `020-scale-baseline.md`; `.claude/rules/migrations.md`
  (P1 is an expand migration — user ops above); `.claude/rules/architecture.md`.
- **Blocked by:** nothing for P2–P5. Q1 still gates P6 sizing only.
- **Measurement status:** DB-level numbers are now **measured**, not estimated (P0). The
  app-level baselines (TTFB, payload bytes, frame time, query counts) are still unmeasured —
  they need a running app + browser, and are the gate for judging P3/P4/P5.

## Roadmap

- ✅ **P0 — Baseline harness.** DONE 2026-08-14. `packages/data/scripts/`:
  `seed-scale-fixture.ts` (deterministic, PRNG seed 20260814), `bench-scale.ts` (EXPLAIN
  ANALYZE over the shapes the apps actually issue, each annotated with its call site), and
  `scale-fixture-guard.ts` — the destructive-write target guard, extracted pure and
  **unit-tested (17 tests)** because its failure mode is silent data loss, not a red test.
  Fixture lives in its own `sunbnb_scale` DB, never `sunbnb_test` (the integration suites
  TRUNCATE that between files). Baselines recorded in `020-scale-baseline.md`.
  Deferred (needs a running app + browser, not SQL): partner inventory TTFB/payload, user
  site-detail TTFB/payload, schematic pan frame time, manage render+query count, `moveParcel`
  wall time. Those are the gate for P3/P4/P5.
- ░ **P0 (original spec, for reference).** Seed a synthetic site at the Q1
  target size into `sunbnb_test` (N parcels × M seats, a realistic reservation load incl. at
  least one sticky `to = 2999-12-31` block — see the P5 note). Capture baselines for:
  (a) partner inventory tab TTFB + payload bytes, (b) `getAvailability` wall time,
  (c) user site-detail TTFB + payload bytes, (d) schematic canvas pan frame time,
  (e) manage page render time + query count, (f) `moveParcel` on a 60-seat parcel.
  Deliverable: a repeatable script + a committed baseline table this track's phases are
  measured against. **Without this, no later phase can be shown to have worked.**

- ✅ **P1 — Indexes.** DONE 2026-08-14, migration `20260814065600_add_site_scoped_indexes`
  (three `CREATE INDEX`, no alteration, no drop). Shipped set — **`Reservation(site_id, from,
  to)`**, **`InventoryItem(site_id, group)`**, **`InventoryItem(site_id, number)`**. Headline:
  the conflict guard, which runs inside the booking `FOR UPDATE`, went **256ms → 0.98ms
  (261×)**; month revenue 87×; overlap window 84×; a *small* venue's item load 24× (the
  cross-tenant cost). Two candidates measured and **rejected** — plain `(site_id)` (redundant
  behind the composites) and `(site_id, status)` (`active` matches ~99% of a site's seats).
  **One behaviour risk found and fixed:** an index can reorder a `findMany` with no `orderBy`;
  audited all 50 call sites on the two tables, and `getAvailability` → `pickFirstAvailablePair`
  was genuinely order-dependent (it drives consumer preselection). Fixed + locked by 4
  integration tests, verified to fail 3/4 without the fix. Full gate green: data 360u+350i,
  user 521u+82i, partner 1973u+198i. **The premise changed** — see the Log entry; P1 turned out
  to be ordinary growth work, not large-venue work.
- ░ **P1 (original spec, for reference).** `packages/data` → `data-dev`.
  `InventoryItem` today carries **only** `id` PK + `pair_id` unique; `Reservation` **only**
  `id` PK + `invoice_id` unique (verified against every migration). Postgres does **not**
  auto-index FK columns, so `where: { siteId }` is a **sequential scan of the whole table
  across all tenants** — one large venue slows down every other partner's inventory load.
  Add: `InventoryItem(site_id)`, `InventoryItem(site_id, group)`, `Reservation(site_id, from,
  to)`, `Reservation(site_id, status)`. Confirm the exact set against `EXPLAIN` on the P0
  fixture rather than adding speculatively. Also lands inside the booking lock:
  `findConflictingReservation` (`packages/data/src/reservations.ts:132-158`) filters on
  unindexed `siteId`/`from`/`to`/`status` **while holding `FOR UPDATE`** on the seats
  (`:194-197`) — longer scan = longer lock = worse contention exactly when the venue is busy.
  Pure expand phase; ships ahead of `main` per `.claude/rules/migrations.md`.

- ☐ **P2 — Availability as set-based SQL.** `apps/user` + `packages/data` → `user-dev`/`data-dev`.
  `availabilityService.ts:62-104` loads every active item and every overlapping reservation
  (`include: { items: true, site: true }` — the full `Site` row re-materialized *per
  reservation*), then `checkAvailability` (`:19-49`) filters the entire reservation array per
  item and builds **three dayjs objects per candidate pair**. That is **O(items × reservations
  × party-size)**: ~4.8M iterations and ~1.2M dayjs allocations at 3 000 × 400 × 4.
  Three hot callers:
  - `GET /api/sites/[id]/availability` — **public and unauthenticated**, guarded only by a
    90-day range cap (`route.ts:36`). At this size that is a trivially cheap DoS **today**,
    independent of the rest of this track (see Q4).
  - `countAvailableToday` (`:111-124`) — a JS-counting wrapper, awaited inline on the site
    page's TTFB path (`sites/[id]/page.tsx:93-95`).
  - `saveReservationForMultipleItems` (`sites/[id]/actions.ts:141-154`) — computes availability
    for **every seat on the site** to validate the ≤20 the guest picked.

  `searchSites` (`siteService.ts:184-201`) **already does this correctly** as a `NOT EXISTS`
  aggregate, and the file flags the divergence risk in a comment at `:143-150`. Converge on
  that shape. Care needed: the site-wide set currently doubles as an existence/active check
  (comment at `actions.ts:136-140`), so a narrowed per-booking variant must preserve that
  semantic, not just the availability answer.

- ☐ **P3 — Kill the three render quadratics + memoize.** `apps/partner` + `apps/user` +
  `@repo/schematic` → `sunbed-inventory`/`user-dev`, `/ui` + `/schematic` primed.
  | Location | Pattern |
  |---|---|
  | `InventoryMap.tsx:210` | `items.find(i => i.id === selectedItemId)` **inside** the map over all items |
  | `SchematicRenderer.tsx:839-847` | `items.some(...)` for `pairedSelected` inside `items.map` at `:824` |
  | `SunbedSelection.tsx:260-265` | `availability.find(...)` called once per item at `:411` |

  ~9M comparisons **per paint** at 3 000 seats. `SchematicRenderer` re-renders on pan
  (`:395`), pinch (`:427`), wheel (`:359`) and drag (`:226`) — so panning runs the quadratic
  **plus** a 10–25k-node SVG reconcile *per pointer event*. Fix: `Map`/`Set` lookups hoisted
  out of the render body, `React.memo` on the marker/seat components, stable callback
  identities. The latter also fixes `SunbedMarker.tsx:154-165`, whose pointer `useEffect`
  depends on inline arrows recreated every parent render (`InventoryMap.tsx:248-252`) — so
  every render tears down and re-attaches **4 DOM listeners on all N markers**.
  Secondary, same phase: `ParcelView.tsx:248` calls `allRegularItems.filter(...)` from inside
  the row × column loop at `:290` → O(rows × cols × N); `manage/view.tsx:423-433` runs four
  full filters + a site-wide `getBedState` summary per render; `bed-state.ts:186-224` invokes
  `deriveState` ~4-6× per seat per render.
  **Constraint:** `bed-state.ts` is a presentation shell over the [[track:018]] machine's
  `deriveState` — memoize the *calls*, never fork the derivation. One derivation, always.

- ☐ **P4 — Batch the writes (carries two correctness fixes).** `apps/partner` +
  `packages/data` → `sunbed-inventory`/`data-dev`.
  - **`moveParcel` is not in a transaction** (`inventory/actions.ts:382-397`) — N individual
    UPDATEs via `Promise.all`. At 8 seats a partial failure is unlikely; at 200 through a
    serverless pool it is not, and the result is a **silently half-moved parcel**. This is a
    correctness fix worth doing regardless of scale.
  - **`createInventoryItem`** derives the next `number` via `findFirst({ orderBy: { number:
    'desc' } })` (`inventory-actions.ts:16-19`) — unindexed scan **and** a read-then-write race.
  - Same one-statement-per-row shape in `moveItems` (`:446`), `rotateSelection` (`:580`),
    `adjustItemSpacing` (`:685`), `reverseParcelNumbering` (`:864`), `reverseParcelOrientation`
    (`:896`), and `syncChairsWithLayout` (`:98` — N `create` calls, no `createMany`).
  - **`assignChairPairings`** (`:275-328`) is a `for` loop with awaits **inside** — ~3–5
    serialized round-trips per pair, ≈150 sequential queries after a 60-seat paired parcel.
  - **`recomputeSeatLabels`** (`packages/data/src/seat-label-db.ts:17-50`) does a full-site
    read + N UPDATEs and is called after nearly every mutation. Worst case: marquee-select 200
    seats → delete → `view.tsx:441` fires **200 server actions**, each with its own full-site
    scan and full-site label recompute.
  - Bug, same area: **`deleteItemsByGroup` is the only bulk op that skips
    `recomputeSeatLabels`** (`inventory-actions.ts:377-387`) — surviving parcels keep stale
    labels. Note the coordinate columns are `String` (`schema.prisma:306-307`), which is
    *why* a set-based `SET location_lat = location_lat + $1` isn't expressible today; decide
    whether P4 casts or Q5 retypes them.

- ☐ **P5 — Get work off the render path.** `apps/partner` + `packages/data`.
  - **Manage does a write-N+1 on render.** `manage/sunbeds/page.tsx:139-147` sequentially
    awaits `resolveTodayRow` — a `reservationDay.upsert`, i.e. a **write** — once per
    *seat-reservation* (a 4-seat party is upserted 4× for the same key). It runs on every RSC
    render **and** every 30s poll (`view.tsx:406-409`), from **every open device on the
    floor**. Ten tablets on a busy 3 000-seat beach is a sustained write load on a GET path.
    *This is the deferred perf follow-up already recorded in [[track:012]]* ("`page.tsx`
    lazy-upserts sequentially — batch if perf shows up"). It has shown up.
  - **Orders dashboard polls 4× per 5s** (`orders/view.tsx:640-661`: three `scopedGetOrders`
    + `fetchOpenTabs`), each re-running `verifySiteAccess`, and `getOrders` (`actions.ts:93`)
    has **no `take` and no date filter** — on the history tab that re-downloads the site's
    entire order history every 5 seconds.
  - **Occupancy analytics re-walk sticky blocks.** `analytics.ts:450-509` re-filters all
    reservations per day and walks every seat of every overlapping reservation into 5 `Set`s,
    per day. Out-of-service blocks carry `to = 2999-12-31` (noted at `:127-129`), so they
    overlap **every** day and are re-walked 90× on a 90-day trend. All of `analytics.ts` is
    in-memory JS over `findMany` — no `groupBy`, no raw SQL. Cross-ref [[track:007]].
  - **Payload narrowing.** `apps/partner/app/sites/site-page.tsx:29-49` — the wrapper for
    *every* site tab — loads all items with **every reservation they have ever had**, no date
    filter, plus `pair`/`pairedBy` as fully materialized nested objects. `queries.ts:13-34`
    (`getSite`) is the same plus `sunbedGroup.items`, and it is refetched after **every**
    mutation (`inventory/view.tsx:66-69`, ~18 call sites in `schematic/view.tsx`). On the user
    side the full active-item list is serialized **twice per load** — once in the RSC flight
    payload (`sites/[id]/page.tsx:99`), once again over `/api/sites/[id]` (`view.tsx:104`).
    Add reservation date windows + `select` narrowing; kill the double-ship.

- 💤 **P6 — Structural: stop shipping the whole site.** Gated on Q1. Viewport culling /
  clustering on the map, virtualization or parcel-scoped loading for the schematic canvas,
  and parcel-scoped queries instead of site-scoped. Only needed if Q1's target is genuinely
  in the thousands; P0–P5 may well carry us to ~1 000. **Do not start this before P0 proves
  P1–P5 insufficient.**

## Open decisions

1. ❓ **Q1 — What size must we actually support?** ~500 · ~1 500 · ~3 000+ seats. This is the
   single load-bearing question: it decides whether P6 exists, and it sizes the P0 fixture.
   Everything else in this track is worth doing at *any* target.
2. ❓ **Q2 — Is there a real prospect driving this, or is it pre-emptive hardening?** A signed
   large venue makes this urgent and dates it; pre-emptive means P1 + P4's correctness fixes
   ship now and the rest waits for demand. (Precedent: [[track:010]]'s parked surpass layer —
   we do not build unvalidated demand.)
3. ❓ **Q3 — Do we add a stopgap cap** on parcel size / seats-per-site, so a partner cannot
   walk into the broken zone unannounced while this track is open? Cheap; a UI validation plus
   a server guard in `syncChairsWithLayout`.
4. ❓ **Q4 — Rate-limit / auth the public availability endpoint?** `/api/sites/[id]/availability`
   is unauthenticated and O(site size). This is a **live exposure at current sizes**, not just a
   scale concern — it may deserve to jump ahead of this track entirely. Note the in-memory
   limiter (`@repo/data/rate-limit`) is per-process and resets on cold start, so it is weak
   protection on Vercel.
5. ❓ **Q5 — Retype the coordinate columns?** `InventoryItem.locationLat`/`locationLng` are
   `String` (`schema.prisma:306-307`), forcing all coordinate math into JS and blocking
   set-based moves. Retyping to `Float` (or PostGIS point) is a contract change with real blast
   radius across both apps and `@repo/schematic` — probably its own track, but P4's shape
   depends on the answer.
6. ❓ **Q6 — Is the schematic editor expected to handle the full site at target scale**, or do
   we accept parcel-scoped editing as the product answer? A product decision that could delete
   most of P6.

## Log

- **2026-08-14 — P0 + P1 built and green (uncommitted, local `main`). The track's central
  premise was measured and partly FALSIFIED.** Built the harness first, deliberately, because
  without a volume fixture an index change is unobservable — Postgres picks a sequential scan
  on a small table no matter what indexes exist, so you cannot distinguish a working index
  from a broken one. That caution paid immediately: at the first fixture size (5 000 items /
  36 400 reservations) the candidate indexes changed **nothing** — every shape stayed a seq
  scan, correctly, since 5 000 rows is ~125 pages and the big venue was 60% of the table.
  **Correction to the scoping claim "one big venue degrades every other partner":** index
  benefit scales with TOTAL table size, not with the big venue's seat count. `InventoryItem`
  may never get large enough to matter much (100 venues × 200 beds is 20 000 rows).
  `Reservation` is the table that accumulates forever, and at 441k rows it was spending
  180–256ms per query on seq scans. **So P1 is not large-venue work at all — it is ordinary
  growth work that the large-venue question happened to surface, and it is worth shipping
  whether or not a 3 000-seat venue ever exists.** Re-sized the fixture to 61 sites / 9 000
  items / 441 222 reservations / 1.1M seat-links and measured properly (all numbers in
  `020-scale-baseline.md`). Index set chosen by measurement, adding candidates one at a time
  to attribute each: `(site_id)` and `(site_id, status)` were **dropped** after measuring as
  redundant/non-selective — an unused index is pure write amplification on exactly the bulk
  parcel operations P4 exists to speed up. **Risk work, since the ask was "don't break the
  app":** the non-obvious hazard in an index-only migration is that it can change the physical
  row order of any query without `ORDER BY`; audited all 50 `findMany` call sites on the two
  tables (39 had none), and found exactly one order-dependent path —
  `getAvailability` → `pickFirstAvailablePair`, whose docstring claimed an "ordered array"
  that was in fact planner order, and which chooses the seat preselected for the guest
  (track 014). Fixed by ordering on seat number (also makes the choice *meaningful*: lowest
  number = the operator's own first seat), locked by a new integration test file whose value
  was verified by removing the fix and confirming 3 of 4 fail. Everything else is safe by
  construction — `computeSeatLabels` and `reverseParcelNumbering` sort explicitly, the HW
  route emits in binding order via a `byId` map, the rest use sets/maps/`.length`.
  **User ops before any `main` push: `npm run migrate:test`** (additive → expand phase → the
  test DB must lead `main`; the pre-push hook enforces it).
- **2026-08-13 — Created.** Scoped from the founder question "how would our system handle a
  single beach with dozens of parcels and thousands of sunbeds?" Two read-only code sweeps
  (inventory/manage/user-availability/reservation-create; schematic/polling/analytics/HW)
  plus a direct index audit of `schema.prisma` + every migration. **Nothing was changed.**
  Findings: no secondary indexes at all on `InventoryItem`/`Reservation` (the widest-blast
  issue — it degrades *every* tenant, not just the large one); availability is O(I×R×S) in JS
  on three hot paths incl. a public unauthenticated route; three separate O(N²) passes in
  render bodies with zero memoization repo-wide; write paths are one statement per row with
  `moveParcel` lacking a transaction. **What already holds up:** the HW API
  (`hw/[code]/state/route.ts` — bound-seat scoped at `:117`/`:145`, ETag/304 at `:184-202`,
  60s poll floor; never touches site-wide inventory), the schematic *geometry* itself
  (`packages/schematic/src/grid.ts:115` is a clean single pass — the cost is entirely in the
  renderer), `reserveWithConflictGuard`'s PK row-lock (`reservations.ts:194-197`), the manage
  grid rendering one parcel at a time (`manage/view.tsx:1157` — the only thing keeping that
  page alive), and all user-app polling (single-entity, size-independent). Capacity table in
  Goal is **judgment, not measurement** — hence P0.

## Links

- [[track:018-reservation-state-machine]] — `bed-state.ts` is a presentation shell over
  `deriveState`; P3 must memoize the *calls* and never fork the derivation. Hard constraint.
- [[track:012-multiday-per-day-operational-state]] — P5's manage write-N+1 is the sequential
  lazy-upsert that track explicitly deferred ("batch if perf shows up"). This track picks it up.
- [[track:007-operator-analytics]] — owns `analytics.ts`; P5's `getOccupancyByDay` cost and the
  sticky-`2999` block interaction land in its surface.
- [[track:019-hw-api]] — its 💤 P6 fleet scale (~1.3M invocations/day) is the *device-count*
  scale axis; this track is the *venue-size* axis. Independent, do not merge. Its `:159` seat
  select is the one place they touch: a site-wide block drags thousands of seat ids into a
  2-seat device's query.
- [[track:011-group-multiselect-reservation]] — grouped creates reduce reservation-row count
  per party, which mildly relieves P2/P5's per-reservation terms. Complementary, not blocking.
- [[subsystem:schematic-editor]] — the geometry/editor layer behind P3 and P6.
- `.claude/rules/migrations.md` (P1 is an expand migration) · `.claude/rules/architecture.md`
  (cross-app + `packages/data` → architecture pass per phase).
