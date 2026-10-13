# Exports reference — `@repo/data`

Pulled on demand; **not** auto-loaded. The always-loaded summary is `packages/data/CLAUDE.md`.
Read the section for the module you are touching. `package.json#exports` maps each `./<name>`
subpath to its source (mostly `src/<name>.ts` or `src/<name>/index.ts`; `./PrismaCient` →
`index.ts`). Modules not listed here: read the module header.

| Module | Purpose | Key symbols |
|---|---|---|
| `payment-refs` | PURE ref-prefix vocabulary | `providerFromRef`, `isDemoPayment`, `is*Ref`, `PaymentState` |
| `payment-providers/*` | adapter contract, availability, readiness, selection, fee policy | `getOnlineAdapter`, `syncEffectiveProvider` |
| `checkout` | neutral online checkout (Stripe/Viva) | `resolveCheckoutIntent`, `createOnlineCheckout` |
| `stripe/*` | server-only Stripe SDK home | `getStripeClient`, `getStripeConnectClient` |
| `viva/checkout-*` | Viva Smart Checkout (online) | `vivaOnlineHttp` |
| `reservation-machine(-apply)` | reservation state machine | `deriveState`, `TRANSITIONS`, `applyTransition` |
| `device-code` · `site-code` · `partner-code` | PURE printed identifiers | `generate*`, `normalize*`, `isValid*` |
| `invoice-fiscal` | the one AEAT QR builder | via `resolveInvoiceIssuerJurisdiction` |
| `commission-invoice(-model)` | our B2B commission invoice as a document | loader is ownership-scoped |
| `reservation-emails` | confirmation, reminder, cancellation emails (Resend) | |
| `subscription` | partner subscription tier management | |
| `email` | shared Resend sender | |
| `business-entity` | platform business entity for invoicing | |
| `preferences` | platform preferences registry (admin `/preferences`) | `getPreference`, `setDevicePolicy` |
| `device-power` | PURE power modes + poll bands | `resolveDevicePolicyForDevice` |
| `device-wifi` | PURE Wi-Fi pair rules + broadcast window | `validateWifiNetwork`, `shouldSendWifi` |
| `device-telemetry` | retention sweep for `device_telemetry` | `pruneDeviceTelemetry` |
| `assistant-claim` | assistant SQL sandbox runner + claim | `runAssistantSql`, `signAssistantClaim` |
| `coastline-lookup` · `coastline-overpass` | shoreline lookup (DB then Overpass) | `shoreAround`, `fetchCoastTile` |

---

## Payment providers (track 028)

Design record: `.claude/tracks/028-multi-provider-payments.md`. Narrative: `.claude/wiki/subsystems/payments.md`.

- **`payment-refs.ts`** (PURE, client-safe) — every `tr_`/`pi_demo_` check in data, floor-core and
  the apps imports it. `providerFromRef`, `isDemoPayment`, `isMolliePaymentRef`, `isVivaCheckoutRef`,
  `isStripeCheckoutRef`, `isStripeTerminalRef`, `isStripeRef`, plus `PaymentState`
  (`pending|paid|failed|refunded`). Namespaced wrappers: no prefix is a prefix of another.
- **`payment-providers/`** — `types` (PURE adapter contract `OnlineCheckoutAdapter`,
  `ProviderNotWiredError`/`ProviderNotReadyError`); `index` (`getOnlineAdapter('stripe'|'viva')`);
  `availability` (PURE, **founder-editable** country matrix → which providers + `cardPresent`
  kind `none|terminal-app|tap-to-pay`); `readiness` (PURE `providerReadiness`,
  `effectiveProviderFor`, `READINESS_SELECT`, token-free `toReadinessAccount`); `selection`
  (`syncEffectiveProvider(userId)` — idempotent, flips sites only when the selected provider is
  ready); `fee-policy` (PURE, one constant `STRIPE_PROCESSING_ESTIMATE` 1.5% + €0.25 →
  `stripeApplicationFee` = commission + pass-through; caps the application fee at `amount - 0.01`,
  while `platformPassThroughFor` is uncapped — they diverge only for sub-EUR amounts);
  `stripe-adapter` / `viva-adapter` (server-only); `stripe-account` (`stripeAccountForSite`,
  `getStripeRefStatus`).
- **`checkout.ts`** — `resolveCheckoutIntent` (amount + commission for the five kinds, same fee
  loaders as the Mollie paths) and `createOnlineCheckout` (adapter dispatch). Reservation/rental
  ref writes go through the sanctioned `markReservationCheckoutStarted/Failed` and
  `markRentalCheckoutStarted/Failed` writers (single-writer ratchet). Mollie keeps its own routes.
- **`stripe/`** (server-only; the `stripe` SDK is imported only here) — `client`: `getStripeClient()`
  = partner **subscriptions** (`STRIPE_SECRET_KEY`), `getStripeConnectClient()` = **Connect
  platform** (`STRIPE_CONNECT_SECRET_KEY`, falls back to the former); `connect`:
  `CONNECT_CONTROLLER` (`requirement_collection/losses.payments/fees.payer: 'application'`,
  `stripe_dashboard: 'none'`), own-form onboarding helpers, `snapshotFromAccount`/
  `snapshotToColumns`, `createAccountSession`; `checkout`: direct-charge Checkout Sessions
  (`{ stripeAccount }`, `application_fee_amount`), state fetch, `refundPaymentIntent`
  (`refund_application_fee`); `terminal`: `ensureTerminalLocation`, `createConnectionToken`,
  `createTerminalPaymentIntent`, `cancelTerminalPaymentIntent`. Every consumer call passes
  `{ stripeAccount }` — never a platform charge (track 003). Tests mock `./client`, never `stripe`.
- **`viva/checkout-{types,http,stub}`** — Smart Checkout (online), separate from the Cloud Terminal
  `VivaClient`. `checkout-http`: **every unverified ISV field lives inside the one `vivaOnlineHttp`
  builder** (developer.viva.com field names unconfirmed; KYC pending). `checkout-stub`: the store is
  held on **`globalThis`** — Next dev compiles API routes and RSC pages into separate module graphs,
  so a module-level map is two maps. `VIVA_MODE` picks stub/http like the other Viva clients.
- **PLATFORM-invoice pass-through** — for Stripe refs (`stripe_cs_` / `stripe_pi_`), every
  `processConfirmed*` (reservation, order, rental, tab, **table deposit**) adds a VAT-exempt
  `payment-processing` line and sets `Invoice.processingFee` (`platformPassThroughFor`). Viva's ISV
  fee is credited monthly → no pass-through. Each PLATFORM write is gated on
  `commission > 0 || passThrough > 0` (`src/payment.ts`).
- **State machine (Tap to Pay)** — condition `tapToPay` (from `opts.collect.method` on start, the
  `stripe_pi_` prefix on abandon) and effects `stripeTerminalIntent` (card_present PaymentIntent on
  the connected account, writes the ref, returns the client secret) / `stripeTerminalCancel`
  (reverify-once; a succeeded race finalizes, never reverts a possibly-captured tap); interpreter
  `runCollectStartTapToPay`. Viva's twin: condition `cardPresent`, effects `vivaSale`/`vivaAbort`.

## Reservation state machine (track 018)

Narrative + invariants: `.claude/wiki/subsystems/reservation-state-machine.md`. Contract:
`.claude/tracks/018-state-machine-intended.md` (I1–I7); history: `018-state-machine-defacto.md`.

- **`reservation-machine.ts`** (pure, CLIENT-SAFE, backs the partner grid's `bed-state.ts`):
  `deriveState`, `TRANSITIONS` (events × pre-state → post + named effect keys; unmatched =
  MUST-REJECT), `resolveTransition`, `storageForState`/`opForOcc` (writer = reader's inverse),
  `partitionAmount` (largest-remainder cents — splits can never create/destroy money).
- **`reservation-machine-apply.ts`** (server-only): `applyTransition(reservationId, event, opts)` —
  load → deriveState → resolveTransition (typed rejection) → effect executors. Conditions
  (hasFutureDays/sameCivilDay/expired/subset/cardPresent/tapToPay…) are interpreter-computed FACTS;
  callers pass intent only. Executors: day-row + parent mirror (atomic), till record/void/PARTITION,
  receipts + credit notes, split lineage (`splitFromId`), collect flow (demo/Mollie/Viva
  terminal/Stripe Tap to Pay; abandon NEVER frees a bed), providerRefund, I4 delete defense.
- **`reservation-machine-guard.test.ts`** — single-writer ratchet over all apps; exact-equality,
  shrink-only `ALLOWLIST` (currently: `reservations-cleanup` cron sweep 1 — I4-filtered by design —
  + `manage/actions.ts` 8).
- Consumers: partner manage/frontdesk/reservation-detail actions; user-app webhook/poll/reconcile/
  cancel/delete/demo-initiate. The partner matrix (`state-machine-matrix.integration.test.ts`)
  drives real actions against the table.

## Printed identifiers — device, site, partner codes

### `device-code.ts` (track 019)

Pure, client-safe (no prisma, no env): `DEVICE_CODE_ALPHABET` (Crockford base32 — `0-9A-Z` minus
`I L O U`; the ambiguous glyphs are out because a human reads a code aloud from a windy beach, `U`
so a sticker can't mint an obscenity), `DEVICE_CODE_LENGTH` (6 ≈ 1.07e9), `generateDeviceCode`
(CSPRNG + 5-bit mask — 256 is a multiple of 32, so no modulo bias; random NEVER sequential, which
would leak fleet size), `normalizeDeviceCode` (uppercase, `I`/`L`→`1`, `O`→`0`), `isValidDeviceCode`.

**The route re-exports `normalizeDeviceCode` rather than re-implementing it** (`hw-filter.ts`
`normalizeCode`): minting and lookup sit on opposite sides of a sticker glued to a potted device,
so a code minted under different folding rules than the route normalises by is permanently
unreachable. The round trip (`normalize(generate()) === generate()`) is the load-bearing test.

**Provisioning** (`scripts/provision-device.ts`, track 019 P3):
`npm run device:provision -- --partner <partnerAccountId>` (local; `:test` / `:production` are
env-tiered). Mints the `Device` row and prints the code for the sticker. It does **not** place the
device: position is an address assigned in the partner fleet UI once the unit is on a pole. The old
`--seats` flag wrote `DeviceSeat` rows nothing read and left the address null (every device was
declined on its first poll) — it is gone; whoever runs this at a bench has no business knowing which
parasol a unit ends up under. Flags: `--partner` (whose fleet list it appears in — without it nobody
can see it to assign it), `--code` (reuse a code on a board swap), `--mac`, `--dry-run`. Retries on
the `code` unique collision, except when `--code` was explicit (retrying would mint a code that
differs from the sticker). There is no secret to hand over (Q9).

### `site-code.ts` (track 022)

Pure, client-safe: the **site half of the printed QR URL** (`/q/S-K7M2X9/1-1-1`).
`SITE_CODE_PREFIX` (`S-`, so a site, partner (`P-`, `partner-code.ts`) and device (bare) code can't
be confused in a support call), `SITE_CODE_BODY_LENGTH` (6 = 32^6 ≈ 1.07e9), `generateSiteCode`
(CSPRNG + 5-bit mask over `DEVICE_CODE_ALPHABET`, random never sequential), `normalizeSiteCode`
(uppercase, `I`/`L`→`1`, `O`→`0`, `U`→`V`, prefix restored whether given or not — so a hand-typed
lowercase URL still resolves), `isValidSiteCode`, `isSiteCodeCollision` (P2002 attributed to
`code` — every writer mints optimistically and retries, and must NOT swallow the other unique
constraints on `Site`).

Why a site needs an external id: `Site.id` is a 25-char cuid — half of the old 80-char POS URL, and
therefore half of the card's QR-density problem. **Not `slug`**: partner-editable (a rename kills
every printed card), variable-length, no uniqueness constraint. The round trip is the load-bearing
test, as for device codes. `SITE_CODE_BODY_LENGTH` is deliberately its own constant, not a reuse of
`DEVICE_CODE_LENGTH` — the 4 characters of slack under the QR version-3 cap are reserved for a
longer unit ADDRESS (a venue past parcel 99), not for the fleet to spend.

**Minting**: `apps/partner/lib/site-create.ts` `createSiteWithCode` — both partner creation paths
(the wizard and `submitForm`) route through it. Backfill:
`npm run backfill:site-codes:{local,test,production}[:dry]` (fills NULLs only — never rewrites a
code, which would orphan every card already printed for that venue).

## Invoicing documents

- **`invoice-fiscal.ts`** — **the one** builder of the AEAT QR block for any invoice that renders
  one (track 026 P6a). Resolves the regime through `resolveInvoiceIssuerJurisdiction`, never off
  `invoice.account`: on a PLATFORM commission invoice `accountId` is the **recipient**, so the old
  inline version asked the customer's jurisdiction about OUR document — no QR on our invoice to the
  Finnish partner (art. 20 says there must be one), and a QR on a Spanish partner's that would have
  vanished had they turned out to be foral. `receipt.ts` and the user app's `qr.png` route both
  call it, so a document and its filing cannot disagree about whether an invoice is Spanish.
- **`commission-invoice.ts` + `commission-invoice-model.ts`** — OUR OWN commission invoice as a
  readable document (track 026 P6a; model is PURE/client-safe, loader imports prisma). Before this
  a partner saw only a year-to-date aggregate (`getInvoicesByMonth` filters `issuerType:
  'PARTNER'`), so our monthly B2B invoices had no document. Deliberately NOT `ReceiptModel`: two
  identified parties (a *factura completa* `F1`, not a simplified receipt), amounts that sum with
  nothing under the agent model, and a possible reverse-charge declaration; only the
  `ReceiptFiscal` furniture is shared. **Ownership is scoped inside the loader**, not left to
  callers; null means "not yours" and "no such invoice" indistinguishably, so a guessed id cannot
  confirm another partner's invoice exists.

## Platform preferences and devices

### `preferences.ts` (admin app → `/preferences`)

Registry-driven global tunables. `PREFERENCE_REGISTRY` (key · type · label · group · bounds ·
default) is the source of truth; resolution is env var (`PREF_<UPPER_SNAKE_KEY>`) →
`platform_preference` row → registry default. `getPreference` / `getPreferenceCached` (5-min
per-instance cache, for hot paths) / `setPreference` (validates, invalidates the cache) /
`getPreferenceAdminRows`.

- **Validated on the way in AND on the way out** — the setter explains a rejection to the admin, the
  reader silently falls back to the default, because a row can outlive a bounds change or arrive by
  direct SQL and its consumers are in the field.
- Types: `number` · `boolean` · `string` · `enum` (a closed set rendered as a dropdown; the stored
  value is the WIRE ID, never the label, because the id travels to a potted device).
- `device-power-mode` (enum, default `deep_sleep`) and `device-poll-interval-sec` (default 60) — the
  power policy the user app's `/api/hw/{code}/state` serves as `powerMode` + `pollAfterSec`.
- **The one COUPLED pair**: each mode can only keep its own band of cadences (track 025), so
  `setPreference` refuses an interval the active mode cannot serve and RE-FITS the stored interval
  when the mode changes; `getPreferenceAdminRows` reports the interval a device would actually get.
  The coupling lives in this module, not the admin form, so a script obeys it too.
- `setDevicePolicy(mode, interval, adminId)` — the PAIRED writer the admin form uses: validates the
  interval against the mode *being saved* and upserts both keys in one `$transaction`, so the poll
  route never reads a switched mode beside the old interval. It REFUSES rather than re-fits (a caller
  that sees both values is choosing, not drifting); the silent re-fit stays only on the single-key
  path. `resetDevicePolicy()` drops both rows together.
- `getPlatformDevicePolicy()` reads the pair RAW through the cache — the poll route and the partner
  fleet query both hand it to `resolveDevicePolicyForDevice` with the device's own override
  (`Device.powerMode` / `pollIntervalSec`), so the platform value is a DEFAULT. Deliberate
  asymmetry: a platform change reaches a device within the 5-min TTL plus one poll, a per-device
  override on its very next poll — do not "fix" that by caching the override.
- `device-telemetry-retention-days` (default 365, uncoupled) bounds `device_telemetry` and is the
  ONLY thing that does — a storage budget. Shortening it DELETES history on the next daily sweep
  and cannot be undone. ~2.2M rows/day at a 1500-unit fleet on a 60 s cadence: shorten it before then.
- Wi-Fi writers/readers: `setDeviceWifiNetwork` (one transaction, `null` password = keep stored) ·
  `startDeviceWifiBroadcast` / `stopDeviceWifiBroadcast` · `getDeviceWifiBroadcast`, cached on a
  **30 s** TTL (a late START is a nuisance; a late STOP keeps a password reachable).

### `device-power.ts` (PURE — a client component may import it)

The three power modes and their poll bands (continuous 1–15 s · light sleep 10–45 s · deep sleep
30–300 s — floors from `../sunbnb-hw` exp 005, light sleep's ceiling an operating choice past the
27 s crossover), `clampPollInterval`, `resolveDevicePolicy`, person-facing `validatePollInterval` /
`describePollBand` / `validateDevicePolicy` (the ONE write-path pair check, called by both the admin
preferences writer and the partner per-device writer so a refusal reads the same on both), and
`resolveDevicePolicyForDevice` — the device-over-platform cascade, shaped like `resolveServiceFee`.

- A half-set or unreadable override INHERITS the platform pair (half a policy is not one; an illegal
  mode leaves no band to clamp against). An out-of-band interval is CLAMPED inside the device's own
  mode, not bounced to the platform — a narrowing that flipped a `deep_sleep`/300 device to a
  `continuous`/5 default would flatten its cell in three days.
- Bands OVERLAP on purpose — the mode is explicit because it cannot be inferred from a cadence in
  the overlap. Fallbacks point at `deep_sleep` / the cheap end: a wrong slow value costs response
  time, a wrong fast one costs the battery in days.
- `clampPollInterval` vs `validatePollInterval`: same band, different callers — a fielded device gets
  the nearest legal cadence (it cannot read an error), a person gets a refusal naming the mode and band.

### `device-wifi.ts` (PURE — the admin form imports it)

Rules for the Wi-Fi pair a device is given so a unit can move to a new AP without a console (track
019, HW `docs/app-requests/2026-09-26-wifi-health-and-provisioning.md`). `SSID_MAX_BYTES` (32 —
**bytes**: 9 beach emoji are 18 code units and 36 bytes), `PSK_MIN_LENGTH`/`PSK_MAX_LENGTH` (8–63,
or `''` for an open network), `validateWifiNetwork` (write path, explains itself),
`resolveWifiNetwork` (read path, silent, never returns half a pair — the device ignores a lone field).
It **refuses rather than repairs**: edge whitespace is rejected because preference reads TRIM, so a
password stored with a trailing space would be served without it.

BROADCAST is the security posture (Q9 option 2, founder 2026-09-26): credentials are stored but not
served; an operator opens a `WIFI_BROADCAST_WINDOW_MS` (30 min) window and
`shouldSendWifi(startedAt, device.wifiSentAt)` serves **each device exactly once** inside it.
Comparing against the START, not a stored boolean, lets a new broadcast re-arm the fleet without
touching a device row (how a mistyped password is corrected). `isBroadcastOpen` rejects a FUTURE
start stamp and `parseBroadcastStartedAt` reads anything unparseable as "no broadcast": both fail
toward *not* exposing a password on an open endpoint.

### `device-telemetry.ts` (track 019 P6)

Retention sweep for `device_telemetry`, the time series behind `Device`'s telemetry columns. A row is
appended per POLL that carries a report, UNTHROTTLED (founder 2026-09-23) — `reportIsDue` throttles
only the `Device` last-value row (a cache of the latest reading; this table is the record). The poll
interval sets the row rate (1440/device/day at 60 s), so retention is load-bearing at fleet scale.
`pruneDeviceTelemetry()` deletes past `device-telemetry-retention-days`, oldest first, in bounded
chunks: RESUMABLE (whatever it commits stands) and capped per run, because the table is largest
exactly when someone has just shortened the window. Called daily by the user app's
`/api/cron/prune-telemetry`. Volume arithmetic is in the module header — read it before raising the default.

## Assistant SQL sandbox (`assistant-claim.ts`, track 030 D1)

Model-written SQL runs against the REAL database as role `assistant_reader`; Postgres enforces
isolation even if the app's SQL checker is bypassed. Migration
`20261011120000_assistant_reader_role_and_views`.

- **Role** `assistant_reader`: NOLOGIN in the migration (ops script sets LOGIN/PASSWORD), read-only
  default, `statement_timeout 3s`, `lock_timeout 2s`, idle-in-txn 10s, CONNECTION LIMIT 5, no
  CREATE, `search_path = assistant, public`.
- **Views** in schema `assistant` (all `security_invoker` + `security_barrier`, allowlisted columns
  only): `site`, `parcel`, `unit`, `sunbed`, `layout_element` (handle = last 6 of id), `product`,
  `rental_item`, `working_hours`, `reservation` (`paid_via` derived), `reservation_seat`
  (reservation_id, sunbed_id), `food_order`, `food_order_item`, `invoice`. Real cuids are exposed
  only where another view joins on them (parcel/unit/sunbed/reservation/food_order/invoice ids).
  Timestamps are `timestamptz` (stored UTC `timestamp`); the runner sets the site TimeZone.
- **Base tables**: column-level `GRANT SELECT` on exactly the columns the views read (denied columns
  fail even directly), RLS ENABLED (not FORCED; owner/app roles bypass) with `assistant_site`
  policies `TO assistant_reader`. `payment_ref` is NOT granted: `paid_via` comes from SECURITY
  DEFINER helpers that re-check the site.
- **Claim**: `signAssistantClaim({siteId, accountId, ttlSec<=300}, secret)` →
  `siteId.accountId.exp.hexHmac`, carried in the txn-local GUC `assistant.claim`;
  `assistant.current_site_id()` (SECURITY DEFINER) verifies HMAC vs `assistant.claim_secret`
  (reader has no grant) and expiry; anything else → NULL → zero rows.
- **Runner** `runAssistantSql(sql, params, {siteId, accountId, timeZone?, maxRows?})` →
  `{columns, rows, truncated}`: separate pg Pool (max 3), `BEGIN READ ONLY`, txn-local pins, wrapped
  `SELECT * FROM (...) LIMIT $n` (extended protocol, no stacked statements), ROLLBACK, DISCARD ALL.
- **Env**: `ASSISTANT_DB_URL` (reader URL, may be a read replica), `ASSISTANT_DB_CLAIM_SECRET` (app +
  DB), `ASSISTANT_DB_PASSWORD` (ops script only).
- **Ops**: `scripts/setup-assistant-reader.sh <local|integration|test|production>` after the
  migration (header documents building the URL).
- **Residual**: PUBLIC-executable pg_catalog functions (e.g. `pg_advisory_lock`) cannot be revoked
  by a non-superuser; point `ASSISTANT_DB_URL` at a read replica to keep session-lock abuse off the
  primary. Tests: `assistant-reader.integration.test.ts`.

## Assistant persistence (`assistant.ts`, track 030) — detail

- Status constants `ASSISTANT_ACTION_STATUS` (`proposed → applied|rejected|expired|failed`,
  `applied → undone`, rest terminal); pure `canTransition` **plus** a compare-and-set in each UPDATE
  (`markApplied`/`markRejected`/`markFailed`/`markUndone`) so two racing requests cannot both apply.
- TTLs: `ASSISTANT_PROPOSAL_TTL_MS` 1 h (`expireStaleProposals`), `ASSISTANT_UNDO_WINDOW_MS` 24 h,
  `ASSISTANT_UPLOAD_TTL_MS` 30 days (`listExpiredUploads` / `markUploadDeleted` drive the purge cron).
- Conversations: `createConversation`, `getConversationForAccount`, `appendMessages` (append-only,
  accumulates `AssistantUsage` via `addUsage`), `recordConsent` (not yet called).
- Aerial (S7): `setUploadGeoref`, `claimAerialExtraction` (CAS claim; `running` older than
  `AERIAL_STALE_RUNNING_MS` 10 min is reclaimable; a `done` descriptor is returned cached — no second
  model call), `saveAerialDescriptor`, `failAerialExtraction`.
- Migrations `20261011064712_assistant_models` + `20261011083109_assistant_upload_aerial_georef`
  (`assistant_upload.georef` / `.aerial` jsonb).

## Coastline lookup (`coastline-lookup.ts`, `coastline-overpass.ts`) — track 027 → 030 S7a

- `@repo/data/coastline-lookup` — `shoreAround(lat, lng, radiusM)`: the DB-then-Overpass shoreline
  lookup behind marketing `/api/coastline`, shared so the partner assistant's aerial land check reads
  the same shore. Returns raw shore polylines (water on the right) + water rings; reducing them to a
  shore frame is `@repo/agent/geo/coastline`. Needs `COASTLINE_POSTGRES_URL` — every call throws
  without it, and callers fall back to "no shore" (land check skipped).
- `@repo/data/coastline-overpass` — `fetchCoastTile` / `parseCoastAnswer` / `OVERPASS_URLS` (moved
  from `apps/marketing/lib/overpass.ts`): instances are raced, and an answer counts only if complete —
  Overpass reports its own timeouts as HTTP 200 with a `remark`, which must never be cached as "no
  coast here".
