---
id: 020-large-venue-scale
title: Large-venue scale — dozens of parcels, thousands of sunbeds
status: active
created: 2026-08-13
updated: 2026-08-15
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

- **PAUSED 2026-08-15 at a clean seam** (founder's call, after confirming "drag and rotate
  work now" on the live editor). Everything built so far is committed on local `main`,
  unpushed: P0 harness (`4ad3234`) · P1 indexes (`194cdbb`, plus the `6cb50bf` ordering fix
  that must precede them) · P3 slice 1 render quadratics (`c86b9ad`) · pan-regression fix
  (`32f3c53`) · rotation-teleport fix + data repair (`15734fc`). Measured results + REJECTED
  index candidates: **[`020-scale-baseline.md`](020-scale-baseline.md)** — read before
  touching any later phase.
- **Next action (in order):**
  1. **USER OPS before any `main` push: `npm run migrate:test`** — migration
     `20260814065600_add_site_scoped_indexes` is applied to local + `sunbnb_test` only; the
     shared test DB must lead `main` (pre-push hook enforces).
  2. ✅ ~~P4~~ ✅ ~~P2~~ ▶ P5 slices 1+2 done (manage write-N+1 → ≤5 statements; orders
     history capped; occupancy trend de-quadratic'd; site-context payload windowed to
     today — killing a guest-email overshare). **Next: P5 slice 3** (user site-detail
     double-ship) or the P3/P4 deferred tails. Q4 still open (P2 softened it to
     ~36ms/request). Founder verified manage basic ops after slice 1.
  3. P3 follow-up slice (second-order): `manage/view.tsx` per-render site-wide filters +
     `bed-state.ts` derive-call memoization (memoize CALLS, never fork the derivation —
     track 018 constraint). Marquee select also still unexercised in-browser.
  4. Open decisions Q1 (target scale — gates P6 only) and Q4 (rate-limit the public
     availability endpoint — may deserve to jump the queue as a security fix) remain
     unanswered.
- **Do NOT re-run the P0 seeder against anything but `sunbnb_scale`** — it TRUNCATEs. The guard
  refuses `sunbnb_test` and every remote host even with `--force`; leave that guard alone.
- **Context needed:** this file; `020-scale-baseline.md`; `.claude/rules/migrations.md`
  (P1 is an expand migration — user ops above); `.claude/rules/architecture.md`.
- **Blocked by:** nothing for P2–P5. Q1 still gates P6 sizing only.
- **Measurement status:** DB-level numbers are **measured** (P0). App-level baselines (TTFB,
  payload bytes, frame time, query counts) still unmeasured — they need a running app +
  browser; P3's improvement is therefore *proven by construction* (complexity class), not yet
  by measurement.

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

- ✅ **P2 — Availability as set-based SQL.** DONE 2026-08-15. `getAvailability` +
  new scoped `getAvailabilityForItems` (booking validation no longer computes the whole
  site) are two flat, index-driven queries run in parallel: ordered active seats + the
  blocking links of range-overlapping reservations (drives from `Reservation(site_id,
  from, to)`); verdict = Map lookup; `periods` DTO preserved for the public route (falls
  out of the links query free). **Equivalence locked by an oracle test** — the pre-P2
  implementation runs verbatim as referee over a ~90-seat matrix (every status × op ×
  stay-over combo, all six inclusive-overlap boundaries, parties, far-future window):
  answers identical incl. ordering and periods. Absence contract (inactive/foreign/bogus
  ids) locked for the scoped variant. **Measured on the fixture (3 000 seats, 441k
  reservations): old JS loop 64ms (conservative replica — the real path also dragged full
  item rows + a Site row per reservation); naive per-item `NOT EXISTS` — the shape this
  track originally sketched — 1 525ms (24× WORSE than the JS loop); final shape 36ms.**
  Gate: user 521u + 87i (5 new oracle tests), tsc + lint clean.
- ░ **P2 (original spec, for reference).** `apps/user` + `packages/data` → `user-dev`/`data-dev`.
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

- ✅ **P3 (slice 1) — the render quadratics are dead.** DONE 2026-08-14 (uncommitted).
  All four O(N²)-class passes converted to O(1) lookups behind O(n) builds:
  (1) `InventoryMap.tsx` — `selectedInvItem` find hoisted out of the marker map; `SunbedMarker`
  is now `React.memo` with SCALAR position props + item-carrying callbacks, and its
  pointer-listener effect subscribes once per map via the latest-ref pattern (deps were
  `[map, position, zoom, onClick, onDragEnd, onDragMove]` → now `[map]`) — so a parent
  render no longer re-attaches 4 DOM listeners × N markers, and during a parcel drag only
  the dragged group re-renders. Bonus correctness: pointerup now reports the exact drop
  point from a synchronously-written ref instead of the last RENDERED position (which could
  trail the pointer by one move).
  (2) `SchematicRenderer.tsx` — `pairedSelected` `items.some` inside `items.map` replaced by
  `buildPairedSelectedIds` (new pure module `@repo/schematic/pair-selection`, **8 unit tests
  incl. an oracle property-check against the verbatim original expression** — the
  self-exclusion subtlety is exactly what a naive precompute gets wrong); `sortedElements` +
  selection Set + the new build all `useMemo`d, so pan/pinch/drag paints skip them.
  (3) `SunbedSelection.tsx` — availability `.find`-per-item → memoized `Set`;
  `groupPrimaryIds` + `inventoryCenter` memoized.
  (4) `SchematicSelection.tsx` — same Set treatment + `itemById` Map (its `itemVisual` ran
  TWO linear finds per item per paint); `elements`/`items`/`selectedIds` memoized so the
  renderer's new memos actually hold (identity matters downstream).
  (5) `ParcelView.tsx` — `resolveColumn`'s `allRegularItems.filter` per CELL (O(rows×cols×N))
  → per-group index maps built once per render; trailing-position also precomputed;
  `otherGroupMembers` reads the map. Semantics preserved exactly (incl. the cross-parcel
  group quirk).
  Green: schematic 34 (26+8), partner 1973u, user 521u, both apps tsc + lint clean.
  **Deferred to a follow-up slice** (second-order: linear factors, thousands not millions of
  ops, on the live floor-ops surface): `manage/view.tsx:423-433` per-render site-wide
  filters + summary `getBedState` over all items; `bed-state.ts` 4-6 `deriveState` calls per
  seat per render (memoize the CALLS — never fork the derivation, track 018 constraint).
  Browser verification of drag/marquee/selection on the inventory map still owed (P0's
  app-level baselines) — the pointer-path rewrite is the one part tests don't cover.
- ░ **P3 (original spec, for reference).** `apps/partner` + `apps/user` +
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

- ✅ **P4 (core) — writes batched, three real bugs fixed.** DONE 2026-08-15.
  All in `apps/partner` inventory actions; every fix validated by integration tests that
  were run against the PRE-P4 code via git-stash: **3 of 6 fail on old code** (the fixes),
  3 pass (the preserved semantics).
  (1) **`moveParcel`**: was one UPDATE per seat via `Promise.all` with NO transaction
  (60-seat drag = 60 statements, partial failure = silently half-moved parcel). Now TWO
  set-based statements (seats + ItemGroup anchor) in one `$transaction` — atomic and
  size-independent. Raw SQL with casts because geo coords are String columns (Q5);
  raw writes set `"updatedAt"` themselves (`@updatedAt` is client-managed).
  (2) **`moveItems`**: same set-based treatment (`id = ANY(...)`).
  (3) **NaN-delta guards** on both — a non-finite delta in a set-based statement would
  have corrupted the whole parcel in one write (same failure class as the teleport).
  (4) **`createInventoryItem`**: max(number)+1 was a read-then-write race minting SILENT
  duplicate seat numbers (no unique constraint to catch it) — reproduced with 5 genuinely
  concurrent calls. Fixed with `pg_advisory_xact_lock(hashtext(siteId))` in a transaction.
  (5) **`syncChairsWithLayout` create**: one `createMany` instead of one INSERT per seat.
  (6) **`assignChairPairings`**: was a sequential loop, 3-5 awaited round-trips per pair
  (~150 serialized queries per 60-seat paired parcel) AND carried a latent P2025 crash —
  re-pairing seats across two old pairs deleted the same dissolved SunbedGroup twice
  (reproduced with crossed legacy groups). Now: resolve in memory, then one atomic
  interactive transaction (`createManyAndReturn` mints the new groups; priors dissolved
  deduped).
  (7) **`deleteItemsByGroup`** now recomputes seat labels like every sibling mutation.
  Gate: partner 1981u + 206i (6 new integration), tsc + lint clean.
  **Deferred from P4** (already `$transaction`-wrapped, per-row but atomic — lower value):
  `rotateSelection`/`adjustItemSpacing`/`reverseParcel*` single-statement rewrites;
  `recomputeSeatLabels` site-wide-read-per-mutation (needs a design pass — it is the
  remaining per-mutation site scan); the view's delete-per-seat loop (`view.tsx:441`,
  wants a bulk action + gated-actions registration).
- ░ **P4 (original spec, for reference).** `apps/partner` +
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

- ▶ **P5 (slice 1) — the write-N+1 and the unbounded poll are dead.** 2026-08-15.
  (1) **Manage page**: `resolveTodayRows` (new, `manage/reservation-day.ts`) replaces the
  per-seat serial `resolveTodayRow` upsert loop — the whole floor resolves in **≤5
  statements** (1 read + createMany skipDuplicates + ≤2 grouped present-state syncs +
  1 final read) instead of one WRITE per occupied seat per render per device; party seats
  deduped by reservation. Seed logic extracted to a shared `seedValuesFor` so the single
  and batch paths cannot drift; 5 integration tests pin parity (walk-in/comp mirror,
  stale-sync vs cycling-row-untouched, concurrent batch race).
  (2) **Orders dashboards** (site + restaurant twins): the history tab — which accumulates
  for the site's LIFETIME and is re-fetched every 5s — is capped to the latest
  `HISTORY_TAB_LIMIT` (200) rows, fetched desc + reversed so the display order is
  unchanged. Kitchen tabs stay unbounded (transient sets). Unit tests both scopes.
  Gate: partner 1983u + 211i, tsc + lint clean.
  **Slice 2 (2026-08-15, later):** (3) `getOccupancyByDay` restructured — each reservation
  is distributed onto its overlapping days ONCE (binary search + span walk) instead of
  re-filtering the whole list per day (O(days×N); the sticky `to=2999` block was re-scanned
  on all 90 days of a trend). Day-lists preserve input order so the per-day priority
  classification is byte-identical; locked by the existing 45 analytics integration tests.
  (4) **Site-context payload windowed to the venue-local today** (`todayReservationsWindow`
  in `queries.ts`, applied in both `site-page.tsx` and `getSite`): the consumer audit found
  the ONLY reader of `inventoryItems[].reservations` outside /manage is the brand page's
  availability stat — yet every site tab shipped every reservation in site history WITH
  guest emails to the partner client (privacy exposure, payload grew with lifetime). The
  brand stat semantics changed deliberately: "no reservation overlapping today" instead of
  "never reserved in the site's lifetime" (a seat booked once years ago counted unavailable
  forever). Gate: partner 1983u+211i, data 360u+395i, builds 4/4.
  **P5 remaining (slice 3):** the user site-detail double-ship (RSC payload +
  `/api/sites/[id]` refetch — needs a read of the view's RTK flow first).
- ░ **P5 (original spec, for reference).** `apps/partner` + `packages/data`.
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

- ☐ **P6 — LOD + viewport culling (founder-directed, 2026-08-15).** Q1/Q6 effectively
  answered: the founder wants massive seat counts supported and named viewport culling as
  the mechanism. Design sharpened during that exchange: **culling alone only helps zoomed
  IN** (zoomed out, all 3 000 seats are inside the viewport) — the full answer is two-tier:
  (a) **LOD**: below a zoom threshold render PARCELS (hull + available count — the user map
  already draws both; they become the only render at low zoom), seats only above it;
  (b) **bounds culling** at seat-level zoom (bounds + pan margin, re-filter on map idle).
  Applies to the partner inventory map, the user selection map, and the schematic canvas
  (viewBox intersection there). The manage grid needs nothing (already parcel-scoped).
  **Founder design refinement (2026-08-15): the editor's low-zoom tier renders parcel
  BOUNDING BOXES sourced from `ItemGroup` rows alone — never loading the seats.** ItemGroup
  already carries anchor + rows×seatsPerRow + gaps + rotation, so the box is exact pure
  math (the generateChairs footprint without generating) and a 3 000-seat overview is ~40
  rows instead of 3 000. This bounds the PAYLOAD, not just the DOM. It works because
  parcel-level operations never need seat data client-side: box drag → `moveParcel(delta)`
  (set-based since P4), rotation/spacing → server-side rearrange from the anchor. Seats
  stream in per parcel / per bounds on zoom-in or parcel focus (served by the P1
  `(site_id, group)` index), then existing seat-level editing takes over unchanged.
  Fallback for legacy parcels WITHOUT an ItemGroup row and for loose/ungrouped seats:
  load items for just those (typically few). Requires restructuring the site-context load
  (site-page/getSite currently ship all items to every tab) — the inventory tab gains its
  own tiered loader; other tabs need item COUNTS at most.
  **Sequence: measure FIRST** — the deferred P0 app-level baseline (seed the 3 000-seat
  fixture venue into the dev DB, load the editor + user site page, measure load/pan) sets
  the before-numbers P6 is judged against; this track has twice shown "obviously faster"
  shapes measuring slower.
- 💤 **P6 (original spec, superseded).** Gated on Q1. Viewport culling /
  clustering on the map, virtualization or parcel-scoped loading for the schematic canvas,
  and parcel-scoped queries instead of site-scoped. Only needed if Q1's target is genuinely
  in the thousands; P0–P5 may well carry us to ~1 000. **Do not start this before P0 proves
  P1–P5 insufficient.**

## Open decisions

1. ✅ **Q1 — answered by direction (2026-08-15):** the founder wants "massive amounts of
   seats" supported; P6 (LOD + culling) is unpaused. No numeric ceiling named — treat the
   3 000-seat fixture as the working target. Original question for reference:
   ~~What size must we actually support?~~ ~500 · ~1 500 · ~3 000+ seats. This is the
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

- **2026-08-15 (evening) — Founder-reported: one-day bookings rejected + console
  "serialization errors". Both diagnosed via a NEW layer-0 e2e spec; neither was track-020
  code.** (1) The rejection was track 017 P3's exclusive-checkout anchoring
  (`saveReservationForMultipleItems` anchored the `to` civil date to venue MIDNIGHT while
  every client — the picker emits `[firstDay.startOf, lastDay.endOf]`, the track-014
  one-tap default `[today.start, today.end]` — sends the INCLUSIVE last day): from == to
  at venue midnight rejected every one-day booking, and multi-day stays were UNDERBILLED
  by one day (13th→15th picked = 3 days pre-017, 2 days exclusive). Fix: `to` anchors to
  the venue END of its day (`.end`) — restores pre-017 billing and stored-`to` overlap
  semantics exactly, venue-anchored. The 017 test asserting "exclusive checkout → 2 days"
  was flipped to inclusive; 3 more date fixtures corrected; new one-day regression tests
  (unit + integration + the e2e below). PROD never had 017 P3, so no prod data exposure;
  TEST may hold a few short-stored multi-day rows from founder testing (cosmetic).
  (2) The "serialization errors" were two things: a STALE `.next` incremental build
  (availability route 500'd with `Cannot find module './vendor-chunks/tz-lookup.js'` —
  HTML error page fed to RTK Query; fixed by killing the server and clearing `.next` — the
  kill-app-before-dev rule striking again) layered over pre-existing dev-only Redux
  serializableCheck warnings (Date objects in `sites.selectedItems`/`reservationDay` etc.,
  plus RTK Query's `meta.baseQueryMeta.request`). The store now exempts exactly those
  documented paths, so real console errors are visible again.
  **The e2e layer grew its first real layer-0 spec**:
  `consumer-one-day-booking.spec.ts` — self-seeding (support/db.ts psql helper), drives
  the real one-tap guest flow to the reservation page and asserts the DB row; the
  cookie-dismiss fixture now handles the current "Decline/Accept all" banner. Green:
  user 521u + 88i, e2e smoke + layer-0 pass with a clean console.

- **2026-08-15 (P2) — set-based availability shipped; the harness earned its keep TWICE.**
  The naive per-item `NOT EXISTS` — exactly the SQL shape this track's original P2 spec
  sketched — measured **1 525ms on the fixture, 24× slower than the JS loop it replaced**
  (it probes every seat's entire reservation history instead of driving from the ~160
  reservations the date range selects). Without the P0 fixture that shape would have
  shipped with a "converted to SQL, must be faster" narrative and REGRESSED the public
  endpoint by an order of magnitude. Second catch: an `= ANY(<442 ids>)` periods filter
  cost +38ms and was provably a semantic no-op. Final shape: two flat range-driven
  queries in parallel, 36ms, verdict via Map. Equivalence proven by running the OLD
  implementation verbatim as an oracle (same pattern as pair-selection): seeded matrix
  across statuses × op-statuses × stay-over × overlap boundaries; identical answers.
  Q4 (rate-limiting the public endpoint) remains open but the per-request cost is now
  ~36ms at 3 000 seats. Also recorded: `searchSites`' available_count subquery still uses
  the correlated wrong-side shape — fine at LIMIT 20 small sites, worth converging on the
  links-shape if search radius ever includes a mega-venue.

- **2026-08-15 (P4) — batched writes shipped; the git-stash validation pattern.** Rewrote the
  inventory write paths set-based (details in roadmap P4). The method note worth keeping:
  every behavioural claim was validated by running the NEW integration tests against the OLD
  code (`git stash push <files>` → run → `git stash pop`) — 3/6 failed exactly where the
  fixes are (NaN guard, concurrent duplicate numbers, P2025 double-delete) and 3/6 passed
  exactly where semantics had to be preserved (delta arithmetic, subset scope, pool
  exclusion). That split is the strongest cheap evidence a rewrite can produce: it proves
  both that the bugs were real and that the refactor changed nothing else. Also of note:
  the raw-SQL rewrite made the unit tests assert STATEMENT CONTRACTS (SQL shape + bind
  values via a tagged-template helper) while the ARITHMETIC moved to integration tests —
  the honest split when mocked Prisma cannot execute SQL. Advisory-lock precedent
  (`pg_advisory_xact_lock(hashtext(siteId))`) now exists in the codebase for
  max+1-style minting; reusable for any per-site serialization need.

- **2026-08-15 — Founder confirmed on the live editor: "Drag and rotate work now."** Closes
  both incident loops (pan regression `32f3c53`, rotation teleport `15734fc`) with the only
  verification that outranks the browser runs — the operator who hit the bugs.
- **2026-08-15 (later) — Parcel-rotation TELEPORT: pre-existing data-corruption bug found
  via founder report, fixed, data repaired, browser-verified.** Founder: "rotation change
  displaced or hid the parcel; setting rotation to 0 didn't restore it." NOT a track-020
  regression (`git log -S` dates the code to `2241625`, no 020 commit touched it) — but
  found because 020's drag work got the founder exercising the editor. Mechanism, proven
  from the DB: the rearrange's centroid-preservation block computed the "old centroid" over
  `findMany({ siteId, group })` — which includes POOL seats (group extras) at sentinel
  (0,0). With 60 real + 6 pool seats, each ParcelForm apply shifted the regenerated grid
  AND the persisted ItemGroup anchor by anchor×(60/66); the founder's ~10 rotation attempts
  left Brisa Marina parcel 1 at exactly **(60/66)^10 = 0.3856 × site coords on both axes**
  — mid-ocean near the equator ("hidden"), and every further attempt compounded it
  ("rotation 0 didn't restore"). Fixes (all server-side, `inventory/actions.ts`): rearrange
  `existing` excludes pool (also kills two latent siblings: pool seats being assigned
  leftover grid positions, and a pool seat at existing[0] triggering a DUPLICATE ItemGroup
  create); a **centroid-shift sanity guard** (legit shifts are metres; >0.01° / >10
  schematic units means poisoned state — skip the shift so corruption can never persist or
  compound again); pool excluded from rotateSelection/adjustItemSpacing/moveItems geometry
  and from moveParcel (sentinels had measurable accumulated drag drift); complete-parcel
  anchor-update gates now compare against selected IG members, not raw selection length.
  (view.tsx needed nothing — its `inventory` already filters pool; first-draft edits there
  were reverted as redundant.) **Data repaired**: parcel 1 translated back by the exact
  corruption delta (60 seats + anchor; grid shape and spacing preserved; landed centred on
  the site pin — founder drags it to its final spot). **6 new unit tests** (partner 1979u
  green) incl. the corrupt-shift-skipped and small-shift-still-applied pair; **browser
  proof** on a seeded 4-real+2-pool parcel: two "Rotate +5°" applies through the real UI →
  centroid drift 5.3px, DB shows rotation=10, seats within a metre of home, pool sentinels
  byte-identical at (0,0). Verifier skill gained the parcel-chip/rotate mechanics + the
  teleport check.
- **2026-08-15 — P3 regression (founder-reported) found, fixed, BROWSER-VERIFIED.** The
  flagged risk materialized: dragging a seat panned the map. Root cause confirmed in library
  source: `AdvancedMarker` renders `null` until Google Maps supplies its content container
  (`if (!contentContainer) return null`), so the marker SVG mounts ASYNC after the component
  — the P3 `[map]`-dep listener effect ran while `svgRef.current` was null, attached nothing,
  and never re-ran. No pointerdown → no `preventDefault`/`draggable:false` → greedy map pan.
  The old code was only accidentally immune (its per-render-fresh callback deps re-attached
  constantly — the very churn P3 removed). Fix: the SVG element is now **state via a callback
  ref** (`[svgEl, setSvgEl]`), listener effect keyed `[svgEl, map]` — fires exactly when the
  portal-rendered node mounts, keeps the attach-once perf win. **Verified in a real browser**
  (Playwright headless against the dev app, impersonation rail for the session-gated page,
  throwaway seeded site, deleted after): click selects (amber stroke), reference seat drifted
  0.0px during drag (no pan), 4 grouped seats moved in formation, and the DB shows all four
  parcel rows moved by the IDENTICAL delta with spacing preserved while the solo seat's
  coords stayed byte-identical. New verifier-skill recipe: "Partner inventory map" (the
  impersonation handle + the no-pan/formation/DB assertions), so the next session doesn't
  re-derive it. Lesson recorded there too: listeners on portal-rendered marker DOM must key
  on the ELEMENT, never just `[map]`.
- **2026-08-14 (later) — P3 slice 1: render quadratics killed; P0+P1 committed.** P0+P1 went
  in as three commits (`6cb50bf` availability ordering fix — deliberately FIRST, it protects
  against index-induced reorder; `4ad3234` harness; `194cdbb` indexes). P3 then converted all
  four quadratic render passes to indexed lookups (details in the roadmap entry). The only
  logic extracted rather than transformed in place is `buildPairedSelectedIds`
  (`@repo/schematic/pair-selection`) — extracted BECAUSE it has a subtle self-exclusion
  semantic worth locking: its test file includes an oracle property-check that runs the
  verbatim original O(n²) expression against the O(n) replacement over a 200-item generated
  fixture. The `SunbedMarker` rewrite (scalar props + latest-ref + `React.memo`, pointer
  effect deps `[map]`) is the one change with real behavioral surface — pointer handlers are
  untestable without a browser, so it carries an explicit browser-verification debt (Resume
  here #2); it also FIXES a latent bug (drop position could trail the pointer by one move,
  since pointerup read the last rendered position). Deferred as a follow-up slice:
  `manage/view.tsx` linear-factor scans + `bed-state` derive-call memoization — second-order
  cost on the operationally hottest surface; not worth bundling into this diff. Gate:
  schematic 34 (26+8 new), partner 1973u, user 521u, tsc+lint clean both apps, `turbo build`
  4/4 green (the only gate that catches client/server import violations).
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
