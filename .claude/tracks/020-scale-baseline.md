# Track 020 — scale baseline

The measured reference this track's phases are judged against. Every figure here
came from `packages/data/scripts/bench-scale.ts` against the fixture built by
`seed-scale-fixture.ts` — nothing in this file is an estimate.

**Reproduce:**

```bash
cd packages/data
docker exec sunbnb-postgres psql -U postgres -c "CREATE DATABASE sunbnb_scale;"
npm run scale:setup     # migrate deploy → sunbnb_scale
npm run scale:seed -- --control-sites=60 --history-months=24 --history-per-month=300
npm run scale:bench     # add --plans for full EXPLAIN, --json for diffing
```

The seeder is deterministic (fixed PRNG seed `20260814`), so the same flags
produce byte-identical data on any machine. It refuses to run against anything
but `sunbnb_scale` on a local host — see `scale-fixture-guard.ts` and its tests.

## Fixture

| | |
|---|---|
| Sites | 61 (1 big + 60 control) |
| Big site | 40 parcels × 75 seats = **3 000** |
| Control sites | 60 × 100 seats = 6 000 |
| InventoryItem | **9 000** |
| Reservation | **441 222** (24 months history) |
| Seat-links | 1 103 709 |
| Seed time | ~14 min |

The control sites are load-bearing, not decoration: they make the cross-tenant
cost visible. A fixture with only the big venue cannot show a *small* venue
paying for a large one's rows.

## P1 — site-scoped indexes

Migration `20260814065600_add_site_scoped_indexes` (additive; three
`CREATE INDEX`, no table alteration, no drop).

| shape | before | after | change |
|---|---:|---:|---:|
| `reservation:conflict-guard` ¹ | 256.06 ms | 0.98 ms | **261×** |
| `reservation:revenue-month` | 234.39 ms | 2.69 ms | **87×** |
| `reservation:overlap-window` | 180.19 ms | 2.14 ms | **84×** |
| `inventory:max-number` | 9.49 ms | 0.12 ms | **79×** |
| `inventory:by-site-group` | 8.22 ms | 0.21 ms | **39×** |
| `inventory:by-site-CONTROL` ² | 7.58 ms | 0.31 ms | **24×** |
| `inventory:by-site-active` | 9.70 ms | 5.13 ms | 1.9× |
| `inventory:by-site` | 13.88 ms | 8.37 ms | 1.7× |
| `reservation:all-for-items` | 15.85 ms | 16.50 ms | — |

¹ `findConflictingReservation` runs **inside** the booking transaction's
`SELECT … FOR UPDATE`. This is 255 ms of lock hold removed per booking, on the
path that serialises concurrent bookings for the same seats — it mattered most
exactly when a venue was busiest.

² A *small* venue's query. It was slow only because it scanned past every other
tenant's rows. This is the cross-tenant finding, now measured.

The two shapes that barely moved are not failures: both return ~3 000 of 9 000
rows, so most of their cost is heap access and row materialisation, which no
index removes. They are P5's problem (narrow the `select`, window the
reservations), not P1's.

### Indexes measured and REJECTED

Recorded so a later session doesn't re-propose them:

- **`InventoryItem(site_id)`** — redundant. Both shipped composites lead with
  `site_id` and serve plain site lookups as a prefix. Dropping it changed
  nothing; keeping it would be pure write amplification on the bulk parcel
  operations P4 exists to speed up.
- **`InventoryItem(site_id, status)`** — not selective. `status = 'active'`
  matches ~99% of a site's seats, so it cannot narrow anything. Measured
  5.55 ms → 5.37 ms, i.e. noise.

### The finding that corrected the track

At the first fixture size (5 000 items / 36 400 reservations) the indexes made
**zero** difference — every shape stayed a sequential scan. That was Postgres
being right: 5 000 rows is ~125 pages, so a seq scan beats index lookups, and
the big venue was 60% of the table anyway.

The track's original framing — "one big venue degrades every other partner" —
was therefore only half right. Index benefit scales with **total table size**,
not with the big venue's seat count. `InventoryItem` may never get large
enough to matter much: even 100 venues × 200 beds is 20 000 rows.
`Reservation` is the table that accumulates forever, and that is where the
261× sits.

**Consequence for prioritisation:** P1 is worth shipping for `Reservation`
regardless of whether anyone ever builds a 3 000-seat venue. It is not
large-venue work; it is ordinary growth work that the large-venue question
happened to surface.

## Behaviour risk found while auditing P1

Adding an index can change the physical row order of a query with no
`ORDER BY`. Audited all 50 `findMany` call sites on the two tables; 39 had no
`orderBy`. All but one are order-independent (maps, sets, `.length` checks, or
an explicit sort — `computeSeatLabels`, `reverseParcelNumbering`, and the HW
route's binding-order emission are all safe by construction).

The exception: `getAvailability` → `pickFirstAvailablePair`. The availability
array's order *is* the preselection order for the consumer's reserve-first
flow (track 014), and `pickFirstAvailablePair`'s own docstring called it an
"ordered array" — but the order came from an unordered `findMany`, i.e. from
the planner. Fixed by ordering on seat number, which also makes the choice
meaningful rather than arbitrary. Locked by
`apps/user/service/availabilityService.integration.test.ts` (4 tests, seats
inserted deliberately scrambled; verified to fail 3/4 without the fix).

## Not yet measured

P0 as scoped also wanted app-level baselines — partner inventory TTFB and
payload bytes, user site-detail TTFB and payload bytes, schematic pan frame
time, manage render time and query count, `moveParcel` on a 60-seat parcel.
Those are the targets for P3/P4/P5 and need a running app plus a browser, not
SQL. They are deliberately deferred rather than guessed at.
