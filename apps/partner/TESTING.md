# Testing — Partner App (`apps/partner`)

Pulled on demand; **not** auto-loaded. The always-loaded summary lives in
`apps/partner/CLAUDE.md` § Testing.

---

## Testing

```bash
npm run test              # unit tests (2056 tests across 59 files, Prisma mocked)
npm run test:watch        # vitest in watch mode
npm run test:coverage     # unit tests with Istanbul coverage report
npm run test:integration  # integration tests (223 tests across 12 files, real sunbnb_test DB)
```

### Test architecture spine

The test suite includes four meta-guards that enforce architecture invariants:

- **`app/test/auth-matrix.test.ts`** (676 tests) — Drives every action in the gated-action registry (`app/test/gated-actions.ts`) through all auth scenarios (no session, wrong owner, token-only, sudo). The single source of truth for "which actions exist and which gates they must respect."
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
| `app/sites/[id]/inventory-actions.test.ts` | CRUD, auto-increment, ownership, cross-site pair validation; deleteInventoryItems bulk delete (one transaction, one recomputeSeatLabels, site-scope boundary) | 33 |
| `app/sites/[id]/inventory/actions.test.ts` | schematic/pool seat inventory actions; pool-sentinel exclusion from parcel geometry + centroid-shift guard (rotation-teleport regression); P4 set-based write contracts (moveParcel/moveItems raw SQL, batched rearrange unnest UPDATE, createMany, NaN-delta guards) | 66 |
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
| `app/sites/[id]/inventory/qr-url.test.ts` | printed QR card URL (track 022): short address-keyed form, both beds of a unit sharing one target, `seatLabel` unpacked to the address the route resolves by (`2-302-1` → `2-3-2`), the QR v3 length budget, and the fallback to the legacy URL when the site has no code or the label is unparseable | 6 |
| `app/sites/[id]/queries.test.ts` | getSite ownership guard; getInventoryItems scoped-refresh query (ownership, empty-id short-circuit, merge-compatibility shape contract vs getSite) + getItemsByGroups parcel-tier streaming query | 12 |
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
| `app/test/auth-matrix.test.ts` | auth gate matrix over all gated actions | 676 |
| `app/test/coverage-contract.test.ts` | gated-action registry completeness | 4 |
| `app/test/mock-contract.test.ts` | mock module superset of real exports | 17 |
| `app/test/no-inline-money.test.ts` | no hardcoded monetary literals in server actions | 2 |

### Integration tests (`vitest.integration.config.ts`)

Requires local Docker Postgres with `sunbnb_test` DB. No `@repo/data` mocks — all DB logic runs against real Postgres.

| File | What it tests | Tests |
|---|---|---|
| `app/sites/[id]/manage/actions.integration.test.ts` | reserveItem, checkIn, blockBed, splits (machine partition semantics), settled-unreserve row-kept, rental pickup/return, walk-in rental, till (real conflict guard); `resolveTodayRows` batch page-load resolver (seed parity with resolveTodayRow, party dedupe, present-state sync vs cycling-row untouched, concurrent batch race) | 111 |
| `app/sites/[id]/manage/state-machine-matrix.integration.test.ts` | REAL actions driven through the machine's transition table (post-states from resolveTransition; formerly-RED bug-ledger cells B1a/b/c, D2, D10, D12 now green; COVERED/DEFERRED event manifest, shrink-only) | 19 |
| `app/frontdesk/actions.integration.test.ts` | frontdesk transitions against real DB | 5 |
| `app/calendar/actions.integration.test.ts` | createPartnerReservation (real DB writes, availability, cash payment) | 19 |
| `app/sites/[id]/orders/actions.integration.test.ts` | order status transitions and invoice creation against real DB | 13 |
| `app/sites/[id]/site-actions.integration.test.ts` | saveGeneral persists to DB, PostGIS coords, entitlement gate | 12 |
| `app/restaurants/[id]/reservations/actions.integration.test.ts` | table reservation lifecycle, deposit invoicing, double-booking guard | 8 |
| `app/sites/[id]/token-scope.integration.test.ts` | SecurityToken scope policy — manage vs orders gates (real DB) | 5 |
| `app/sites/[id]/rentals/actions.integration.test.ts` | deleteRentalItem active-booking guard, getRentalItems booking count | 5 |
| `app/sites/[id]/parcels.integration.test.ts` | track 020 C2 slice 2: `getParcelSummaries` ORACLE-equivalence vs the pre-C2 per-seat grouping (parcels, counts, ungrouped, pool exclusion), ItemGroup geometry passthrough, legacy null-geometry parcels, site scoping | 4 |
| `app/sites/[id]/item-counts.integration.test.ts` | track 020 C2 payload cut: `getSiteItemCounts` ORACLE-equivalence — the verbatim pre-C2 array computations (brand total/available-today, readiness active>0) run as referee over mixed statuses, pool sentinels, a now-overlapping reservation, an out-of-window one, and cross-site scoping | 4 |
| `app/sites/[id]/inventory/actions.integration.test.ts` | track 020 P4 batched writes against real Postgres: moveParcel exact set-based arithmetic (seats + anchor, pool untouched, NaN rejected), moveItems subset scope, createInventoryItem concurrent number minting (advisory lock), rearrange re-pairing across crossed legacy SunbedGroups (historical P2025 double-delete); deleteInventoryItems bulk parcel delete (group dissolution, survivor pairId sweep, foreign-site scope); pure-rotation rearrange pair-stability (200-seat paired parcel, SunbedGroups/pairIds byte-identical, ~90ms) — 3 of the original 6 verified to FAIL on the pre-P4 code | 10 |

### Mocking patterns

- Use `vi.mock()` with `vi.fn()` in factory (never reference external variables — hoisting), then `vi.mocked(importedFn)` after import for typed references
- Always call `mockAuth.mockResolvedValue(null)` in `beforeEach` — `vi.clearAllMocks()` clears call history but not implementations, so auth leaks between tests if not reset
- For env vars captured at module load time, use `vi.hoisted()`

