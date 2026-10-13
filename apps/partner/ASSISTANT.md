# Partner AI Assistant — surface detail (track 030)

Pulled on demand; **not** auto-loaded. The always-loaded summary is `apps/partner/CLAUDE.md`
§ AI assistant. Mental model / layers: `.claude/wiki/subsystems/partner-assistant.md`.
Track: `.claude/tracks/030-partner-ai-assistant.md`. Tests: `apps/partner/TESTING.md` § AI assistant.

Right-side drawer in the site shell (`site-view.tsx`; full-screen sheet below `lg`) that answers
questions and **makes changes (with Undo)** across every site tab, with depth on
inventory/schematic.

## Principle and act-immediately

- **The model never writes and never draws** — tools return structured intent, deterministic
  server code produces geometry, and every write is an `AssistantAction`.
- **Act-immediately** (D2 superseded 2026-10-11 by the founder): a `propose_*` tool (name kept,
  historical) stores the action AND applies it in the same call via `proposals/act.ts`
  `createAndApply` → the lifecycle's `applyProposal(id, { note: false })`.
- Same re-auth, stale check and snapshot as a manual apply — no parallel write path. It emits the
  `proposal` SSE card with `status: 'applied'` (a done card: summary + short change list + Undo).
- **Exceptions that stay `proposed`:** any diff with `deletes` (typed `DELETE` confirm, not undoable).
- `MAX_ACTIONS_PER_TURN = 5` (`ctx.applied`); the 6th write is refused so the model reports.
- Relative moves under 0.5 m are refused in `inventory-sim.ts` (`MIN_MOVE_M`, whole-batch-of-moves
  only) so the model states the current state instead.

## Gates and models

- Account flag `assistant` (sudo always on) + kill switch `assistantAvailable()`
  (`lib/assistant/config.ts`: `PARTNER_ASSISTANT_ENABLED=1|true` **and** `ANTHROPIC_API_KEY`;
  503 otherwise).
- Models: `PARTNER_ASSISTANT_MODEL` (chat, default `claude-sonnet-5-5`),
  `PARTNER_ASSISTANT_EXTRACTION_MODEL` (plan/aerial vision, default `claude-opus-5-5`).
- `siteId` is bound by the route, never taken from the model; every tool re-runs
  `requireSiteOwner`; model-facing handles are parcel numbers / seat labels / names, never cuids.

## Routes

| Route | Notes |
|---|---|
| `POST /api/assistant` | SSE events `conversation`, `text`, `tool_start`, `tool_result`, `proposal`, `qr_print`, `align_photo`, `error`, `done`; `maxDuration` 60 |
| `GET /api/assistant` | Transcript of the site owner's conversation |
| `GET /api/assistant/uploads/[id]` | Streams an upload to its own account (thumbnails); foreign/expired/purged = 404 |
| `GET /api/assistant/uploads/[id]/image` | Aerial frame: EXIF-oriented, ≤2000 px JPEG, `X-Image-Size` |
| `POST /api/assistant/aerial/[uploadId]/extract` | Opus vision, `maxDuration` 300, CAS-claimed, descriptor cached on the upload |
| `GET /api/cron/purge-assistant-uploads` | Daily 03:40 UTC, `CRON_SECRET` |

## Server actions (`app/assistant/`)

- `actions.ts`: `applyAssistantAction` / `rejectAssistantAction` / `undoAssistantAction` —
  re-authorised, account-scoped CAS transitions via `@repo/data/assistant`.
- `upload-actions.ts` `uploadAssistantFile` (magic-byte sniff, ≤20 MB, 30/day);
  `aerial-actions.ts` `saveUploadGeoref`.
- All registered in `app/test/gated-actions.ts`.

## Proposal kinds

`lib/assistant/proposals/registry.ts` `HANDLERS` — one `KindHandler` per kind:
validate → diff/preview → execute → snapshot/restore.

- Kinds: `site_fields`, `working_hours`, `brand`, `slug`, `products`, `rental_items`,
  `account_fields`, `inventory_batch`, `layout_elements`, `layout_canvas`, `place_image`.
- `inventory_batch` ops are simulated in `inventory-sim.ts`, applied through
  `inventory/parcel-ops.ts` + the inventory actions.
- Handlers WRAP the existing server actions — never re-implement business rules
  (`validator-parity.test.ts` pins propose-time bounds to the actions').
- Pending proposals (deletes only, since act-immediately) expire after 1 h. Undo within 24 h,
  refused when rows changed since apply (order-independent compare — jsonb loses key order).
- Deletes need a typed confirm and are not undoable.

## Tool families (`lib/assistant/tools/index.ts`)

- Reads: `get_site_overview`, `list_parcels`, `get_parcel`, `find_seats`, `list_layout_elements`,
  `list_products`, `list_rental_items`, `get_working_hours`, `get_brand`, `get_content`,
  `get_account_profile`, accounting summary/trend.
- `explain_feature` — knowledge docs `lib/assistant/knowledge/{inventory,schematic,site-tabs}.md`.
- Tab writes: `propose_{site_fields,working_hours,brand,slug,products,rental_items,account_fields,place_image}`.
- Inventory: `propose_{create_parcel,edit_parcel,rotate,spacing,move,set_status,reverse,delete}`
  + `request_qr_print`.
- Schematic: `propose_layout_elements`, `propose_canvas_size`.
- Vision: `extract_schematic_from_plan`, `request_photo_alignment`, `propose_layout_from_photo`.

## Data questions — `sql` tool (D2, replaces the G1 PGlite snapshot)

Files: `tools/sql.ts`, `lib/assistant/sql-schema.ts`, `data-access.ts`.

- Model SQL runs against the REAL DB as role `assistant_reader` via `runAssistantSql`
  (`@repo/data/assistant-claim`, track 030 D1; see `packages/data/CLAUDE.md`).
- **Postgres is the tenant boundary**: RLS on an HMAC-signed claim the tool mints from the
  route-bound `ctx.siteId`/`ctx.accountId` (never model input).
- Also: column-level grants, READ ONLY txn, 3 s statement timeout,
  `search_path = assistant, public` (bare view names work; `assistant.<view>` too).
- Views: `site, parcel, unit, sunbed, layout_element, product, rental_item, working_hours,
  reservation, reservation_seat, food_order, food_order_item, invoice`.
- `sql-schema.ts` is the STATIC DOCS of those views (columns + meaning; feeds the tool description
  and `inspect:data`). `sql.integration.test.ts` fails if it drifts from the live views;
  `DENIED_COLUMN` bars sensitive names.
- `checkSql` stays as a second layer: one SELECT/WITH, no comments/`;`/`$`/quoted identifiers,
  no `INTO`/`FOR UPDATE`/recursive, no `pg_*`/`set_config`/xml/file functions; PostGIS `ST_*` allowed.
- Caps: 200 rows / 30 KB (`totalRows` from a count when truncated).
- Error mapping: `42501` → `column_not_available`, `57014`/`55P03` → `query_too_slow`.
- Kill switch: `ASSISTANT_DB_URL` or `ASSISTANT_DB_CLAIM_SECRET` unset →
  `{ ok:false, reason:'data_access_not_configured' }` (also in `inspect:catalog`/`data`;
  `run_js` data tables come back empty with a note).
- `run_js` `data.<view>` rows come from `readAssistantTables`
  (`SELECT * FROM assistant.<view> LIMIT 5000`).
- To expose a column: migration in `packages/data` (view + grant), then `sql-schema.ts`.

## System inspector — `inspect` tool (G3)

Files: `tools/inspect.ts`, providers `lib/assistant/inspect/<aspect>.ts`, registry
`inspect/index.ts`. One read-only `inspect({ aspect, topic? })` so the model discovers the system
instead of asking. Aspects:

- `catalog` — aspects + which tool answers what; lists only registered tools.
- `data` — ER model GENERATED from `sql-schema.ts`; hand-written `RELATIONSHIPS` with example SQL
  that `sql.integration.test.ts` executes against the real `assistant.*` views.
- `editor` — GENERATED from registered `propose_*` tool schemas (types/ranges/units) plus the one
  `OP_META` table (preconditions, undoable, QR-reprint impact, manual UI path). A new propose tool
  appears automatically but a test requires its `OP_META` entry.
- `space` — frame conventions; topic `sea` via `loadSeaModel`.
- `features` — plan, entitlements + which plan unlocks, flags, site `features[]`.
- `readiness` — mirrors `readiness-checklist.tsx`; selected vs effective provider.
- `money` — fee cascade + VAT + worked example via `@repo/data` helpers only.

Site/account come from ctx (schema has no id field; extra keys rejected). Output capped at 8 KB by
`inspect/fit.ts` (halves the longest list, says so in `_truncated`). To add an aspect: new
provider + one line in `inspect/index.ts`.

## Limits (`lib/assistant/limits.ts`, shared DB counter via `@repo/agent/limits`)

- Per account 30 turns/10 min + 150/day.
- Global `PARTNER_AI_DAILY_TURNS` (default 1000, `0` = off); one team email to
  `ASSISTANT_NOTIFY_EMAIL` when tripped.
- 10 extraction jobs/day (attachment turns, plan extraction, aerial); aerial sub-cap 3/day (only a
  real model call counts).
- 8 model steps/turn; ≤5 attachments/turn.
- Usage recorded on the conversation (+ `aerial.usage` on the upload) — the €2/day cost cap is
  **not** enforced yet.

## Uploads (`lib/assistant/uploads.ts`)

- Blob key `assistant/{accountId}/{uuid}/{name}` in the PRIVATE store
  (`ASSISTANT_BLOB_READ_WRITE_TOKEN`; without it falls back to the default store).
- Documents: PDF → document block, images, DOCX → text (mammoth); HEIC likely unsupported.
- `AssistantUpload.expiresAt` = 30 days; the purge cron deletes the blob and stamps `deletedAt`.
- Never written from a document: IBAN, payment provider, KYC, Verifactu, personal IDs.

## Image placement (`place_image`)

- Targets cover / product / rental_item / brand_logo / brand_background / schematic_underlay,
  by NAME.
- Apply **copies** the upload to a public blob at the deterministic
  `sites/{siteId}/assistant/{uploadId}.{ext}` (re-encoded ≤2400 px, EXIF stripped —
  `lib/assistant/image-process.ts`), so a site image never points at a purgeable upload.
- Brand logo/bg have no Brand-tab UI yet.

## Plan → schematic

`tools/extract-plan.ts` + pure `lib/assistant/plan-extraction.ts`: drawn/printed plan → canvas
size, elements and parcels in schematic metres as separate ordered cards (canvas → elements →
parcels → optional underlay); asks for a real dimension when the plan has no scale.

## Aerial photo → map parcels

`lib/assistant/aerial/*`, pure core in `@repo/agent/{vision,geo}`. Map-layout sites only.

1. `request_photo_alignment` → SSE `align_photo` opens `PhotoAlignLayer`/`PhotoAlignToolbar` on
   `InventoryMap` (seed from DJI XMP / EXIF FOV / site centre + bed-size scale; drag/rotate/scale,
   opacity) while extraction runs in parallel.
2. Confirm saves the georef (`saveUploadGeoref`).
3. `propose_layout_from_photo` fits the cached descriptor (`fitAerialDescriptor`) into
   `inventory_batch` `create_parcel` ops (`aerial/plan.ts`: numbers from max+1, drop < 0.4
   confidence, overlap + land warnings, split >1200 seats).

Land check uses `shoreAround` (`@repo/data/coastline-lookup`), skipped without
`COASTLINE_POSTGRES_URL`. Satellite tiles are never fed to the model (D9).

## Previews

- Ghost overlays (`inventory/GhostLayer.tsx`, `components/assistant/useGhostPreview.ts`, pure
  `geometry-preview.ts` / `layout-overlay.ts`) exist ONLY for pending delete proposals
  (`selectActivePreview` requires `hasRemovals`).
- Applied cards have no PreviewChip / "Show on map".
- A moved group draws ONE connector (centroid → centroid), not an arrow per seat (that was the
  "long streak" bug).

## Resync

- `router.refresh()` never resets client `useState`. So Apply/Undo — and an auto-applied SSE card
  (`assistant-store.ts` dispatches with `auto: true`; `AssistantDrawer` then `router.refresh()`es)
  — dispatches `assistant:applied` (`components/assistant/proposal-events.ts`).
- Each tab holding a client copy subscribes with `useAssistantResync(kinds, refetch)`.
- `lib/resync.ts` `reconcileFields` resets a field only when the server value moved AND the user
  has not edited it; `concerns()` routes `place_image:<target>` to the one tab showing that slot.
- `SiteContext` merges fresh server props instead of reading them once.

## Privacy

Anthropic named as sub-processor in `/legal/privacy` §5 (wording pending founder review). Consent
version on first use is not recorded yet.
