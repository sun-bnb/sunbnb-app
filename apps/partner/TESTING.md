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

The test suite includes six meta-guards (`app/test/`) that enforce architecture invariants:

- **`app/test/auth-matrix.test.ts`** (718 tests) — Drives every action in the gated-action registry (`app/test/gated-actions.ts`) through all auth scenarios (no session, wrong owner, token-only, sudo). The single source of truth for "which actions exist and which gates they must respect."
- **`app/test/coverage-contract.test.ts`** (4 tests) — Fails if the gated-action registry omits an exported server action that has an auth gate in its source. Prevents new actions from silently skipping the matrix.
- **`app/test/mock-contract.test.ts`** (17 tests) — Verifies that the `@repo/data` mock modules expose every export from the real source packages. Prevents silent mock drift (new real export never added to mock → tests silently skip code paths).
- **`app/test/no-inline-money.test.ts`** (2 tests) — Rejects hardcoded monetary literals (`0.XX`, `XX.00`) in server-action source files; enforces use of DB-fetched prices.
- **`app/test/no-hardcoded-tier-pricing.test.ts`** — Rejects local plan-price/commission tables
  (`TIER_FEES`-style constants, `PRO: '2%'`); the catalogue lives only in `@repo/data/pricing-tiers`.
- **`app/test/no-pairid-writes.test.ts`** — Track 021 ratchet: nothing writes legacy `pairId`
  (`SunbedGroup` is the pairing); shrink-only allowlist = `inventory-actions.ts` cleanup sweeps.

### Auth-matrix predicate semantics (`app/test/auth-matrix.ts`)

- The ok/reject predicate checks the error MESSAGE, not just `status`. `AUTH_ERROR_MESSAGES` =
  `'Not authenticated'`, `'Not authorized'`, `'Invalid or expired access key'`.
- `assertReject` needs `status: 'error'` AND one of those messages; `assertOk` needs NONE of them
  (business errors such as "not found" are fine).
- "ok" scenarios run the action body past the gate with `undefined` from every unstubbed
  delegate: new actions must guard (`?? []`, `if (!row) return { status: 'error' }`) — an
  unhandled throw fails a scenario unrelated to auth.
- A new gate helper must emit one of the three messages (lifecycle-style helpers return
  `['forbidden', 'Not authorized']`).
- Before reusing a gate type, check which `prisma.*.findUnique` its appliers stub — a site gate
  type stubs only `prisma.site.findUnique`, so a restaurant-keyed gate passes vacuously
  (hence `'restaurant-token-or-session'`).
- Route handlers (`kind: 'route'`) have no runner: they go on `UNGATED_ALLOWLIST`
  (`coverage-contract.test.ts`, with a reason) and their 401/403/sudo/flag cases are tested in the
  route's own test with the REAL gate over Prisma mocks.

### Mock-contract traps

- `vi.importActual('@repo/data/…')` does NOT return the real module: `vitest.config.ts` aliases
  redirect it to the mock too. `mock-contract.test.ts` therefore parses the REAL
  `packages/data/src/*.ts` with `fs.readFileSync` + regex, and Prisma models via
  `Prisma.dmmf.datamodel.models`. Mocks may be supersets.
- An un-mocked `prisma.<model>.<method>` resolves `undefined` silently; the crash surfaces at the
  first property read, often far from the change. Chain one `mockResolvedValueOnce` per sequential call.
- Not aliased (mock explicitly with `vi.mock` when a test imports them): e.g.
  `@repo/data/mollie-tokens`, `@repo/data/env`, `@mollie/api-client`.

### No React component tests

`vitest.config.ts` `include` is `{app,lib,components}/**/*.test.ts` — no `.tsx`, no jsdom, no
`@testing-library/react`. Verify client `.tsx` with `npx tsc --noEmit` + lint + review; extract
separable logic into a `.ts` module and test that. Adding jsdom + RTL is an orchestrator decision.

### Unit tests (`vitest.config.ts`)

`vitest.config.ts` `resolve.alias` is the source of truth: most `@repo/data/*` DB modules
(`PrismaCient`, `till`, `stripe`, `reservation-machine-apply`, …) point at `__mocks__/@repo/data/`,
while pure modules (`reservation-status`, `payment-refs`, `reservation-machine`, provider
`availability`/`readiness`, `promotion`) point at the real `packages/data/src`. A new `@repo/data`
import needs an alias or a per-file `vi.mock`.

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
| `app/test/auth-matrix.test.ts` | auth gate matrix over all gated actions | 718 |
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
| `app/sites/[id]/parcels.integration.test.ts` | track 020 C2.2: `getParcelSummaries` ORACLE-equivalence vs pre-C2 grouping (counts, ungrouped, pool exclusion), geometry passthrough, null-geometry parcels, site scope | 4 |
| `app/sites/[id]/item-counts.integration.test.ts` | track 020 C2: `getSiteItemCounts` ORACLE-equivalence with the pre-C2 array computations over mixed statuses, pool sentinels, in/out-of-window reservations, cross-site | 4 |
| `app/sites/[id]/inventory/actions.integration.test.ts` | track 020 P4 set-based writes: moveParcel/moveItems arithmetic + scope, concurrent number minting (advisory lock), crossed-SunbedGroup re-pairing, bulk parcel delete, rotation pair-stability | 10 |

### AI assistant (track 030)

Unit config now also includes `components/**/*.test.ts` (pure client modules of the drawer). Files
(test counts at 2026-10-11):

| File | What it tests | Tests |
|---|---|---|
| `app/api/assistant/route.test.ts` | gate chain (kill switch 503 → session 401 → flag 403 → `requireSiteOwner` → limits), conversation scoping, SSE contract, transcript GET | 33 |
| `app/api/assistant/route.attachments.test.ts` | attachment turns: per-turn caps, PDF/image/DOCX blocks, extraction budget | 6 |
| `app/api/assistant/uploads/[id]/route.test.ts`, `.../image/route.test.ts` | owner-only upload streaming; foreign/expired/purged = same 404 | 6 + 3 |
| `app/api/assistant/aerial/[uploadId]/extract/route.test.ts` | aerial extract auth matrix (kill switch, session, foreign upload, flag, mime, map-mode, budget 0) | 11 |
| `app/api/cron/purge-assistant-uploads/route.test.ts` | `CRON_SECRET` fail-closed; failed blob delete left unstamped for retry | 2 |
| `app/assistant/upload-actions.test.ts` / `aerial-actions.test.ts` | `uploadAssistantFile` (sniff, size, daily cap, kill switch) / `saveUploadGeoref` (site owner or sudo, georef validation) | 10 / 5 |
| `app/sites/[id]/inventory/parcel-ops.test.ts` | `rotateParcel` / `applyParcelConfig` / `rotateUnit` / `setSeatsStatus` compositions (Prisma mocked) | 25 |
| `lib/assistant/tools/{sql,run-js}.test.ts`, `lib/assistant/inspect/inspect.test.ts` | `sql` tool with `runAssistantSql` mocked: second-layer gate, claim = route-bound site + owner only, Postgres error mapping, 200 row / 30 KB caps, `data_access_not_configured` kill switch; `run_js` data via the reader; `inspect:data` generated from `sql-schema.ts` | 45 / 14 / 40 |
| `lib/assistant/tools/tools.test.ts` | read tools: site binding, per-call ownership, handles not cuids | 32 |
| `lib/assistant/proposals/{propose,lifecycle,inventory,layout,place-image,types}.test.ts` | propose tools build before→after; apply/reject/undo (re-auth, expiry, staleness, CAS); `inventory_batch` over an in-memory seat table; layout kinds; `place_image` copy-on-apply + undo | 28/36/45/15/24/7 |
| `lib/assistant/proposals/validator-parity.test.ts` | propose-time bounds == the real actions' apply-time bounds | 1 |
| `lib/assistant/tools/extract-plan.test.ts` + `lib/assistant/plan-extraction.test.ts` | plan → schematic: refusals spend nothing, budget, schema-validated output / pure pixel→metre conversion | 25 + 40 |
| `lib/assistant/tools/propose-aerial.test.ts`, `lib/assistant/aerial/{extract,plan,photo-meta}.test.ts` | align/propose tools (map sites only); ≤1 billable call per upload (cached / running = no counters); plan numbering, confidence drop, overlap/land warnings, 1200-seat split; EXIF/DJI seed + georef validation | 10, 6/9/7 |
| `lib/assistant/{assistant,attachments,documents,uploads}.test.ts` | config/limits/kill switch, attachment assembly, DOCX text, upload sniff + Blob seam | 19/11/4/6 |
| `lib/resync.test.ts`, `lib/account-fields.test.ts` | resync merge rule (`reconcileFields`, `concerns`) / account field whitelist + patch | 13 / 14 |
| `components/assistant/*.test.ts` | SSE parser, stream reducer, proposal model, preview/photo-align stores, geometry/layout overlays, photo-align maths, attachment chips, QR request, aerial API client, markdown-lite | 145 |

Integration (`sunbnb_test`): `app/assistant/lifecycle.integration.test.ts` (16 — propose → apply → undo
through the REAL actions; caught the jsonb key-order staleness bug), `inventory.integration.test.ts`
(12), `layout.integration.test.ts` (5), `sql.integration.test.ts` (13 — `sql` / `run_js` data
through the REAL `assistant_reader` role: only the claimed site's rows, forged other-site queries
empty, error mapping, `sql-schema.ts` == live view columns, every `inspect:data` example runs;
needs `ASSISTANT_DB_URL`/`ASSISTANT_DB_CLAIM_SECRET` in `.env.local` +
`scripts/setup-assistant-reader.sh integration`), `app/sites/[id]/inventory/parcel-ops.integration.test.ts`
(13 — editor/assistant parity on real Postgres).

`packages/agent` has its own Vitest suite (`cd packages/agent && npm run test`: claude-model,
loop, limits, schema, `vision/{aerial-schema,extract}`, `geo/{georef,grid-fit}` incl. the
ChairConfig → beds → px → descriptor → fit round trip).

**How it is faked**

- **Model**: never a real API call. The route test mocks `@repo/agent/claude-model` to return a
  `{ name: 'fake', chat }` client driven per test; extraction code takes a deps object
  (`ExtractDeps` for `createExtractPlanTool`, `AerialExtractDeps` for `runAerialExtraction`) whose
  `extract` / `claim` / `allow*` / `read` / `prepare` are `vi.fn()`s returning canned `ChatResult`s
  or descriptors — so "refusal spends nothing" is asserted on call counts.
- **Blob seam**: `@vercel/blob` is `vi.mock`ed (`put`/`del`/`get`) in every upload, place-image,
  extraction and purge test; `lib/assistant/uploads.ts` is the only module that picks the store
  (`ASSISTANT_BLOB_READ_WRITE_TOKEN` → private, else default-store fallback).
- **Persistence**: `@repo/data/assistant` is `vi.mock`ed per file in unit tests; the shared Prisma
  mock (`__mocks__/@repo/data/PrismaCient.ts`) gained `assistantConversation` / `assistantAction` /
  `assistantUpload`. Proposal fixtures live in `lib/assistant/proposals/test-support.ts` (not a test file).
- **Limits**: `@repo/data/rate-limit-shared` mocked; `allowAssistantTurn` / `allow*` take an injectable
  `CounterStore`.

**Meta-guard registrations**: `app/test/gated-actions.ts` registers `applyAssistantAction`,
`rejectAssistantAction`, `undoAssistantAction`, `uploadAssistantFile`, `saveUploadGeoref` (driven by
`auth-matrix.test.ts`); `coverage-contract.test.ts` carries reasoned exemptions for the route handlers
(`/api/assistant` POST+GET, `uploads/[id]`, `uploads/[id]/image`, `aerial/[uploadId]/extract`, the purge
cron) and `updateAccountFields` (session-only) — each pointing at the file that holds its matrix.

### Mocking patterns

- Use `vi.mock()` with `vi.fn()` in factory (never reference external variables — hoisting), then `vi.mocked(importedFn)` after import for typed references
- Always call `mockAuth.mockResolvedValue(null)` in `beforeEach` — `vi.clearAllMocks()` clears call history but not implementations, so auth leaks between tests if not reset
- For env vars captured at module load time, use `vi.hoisted()`

