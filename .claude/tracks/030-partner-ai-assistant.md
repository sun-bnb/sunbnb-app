---
id: 030-partner-ai-assistant
title: Partner AI assistant — site tabs, inventory/schematic editing, documents, photos
status: active
created: 2026-10-11
updated: 2026-10-11
worktree: null
---

## Goal

An AI assistant inside `apps/partner` that a venue operator can talk to while setting up and
running a site:

1. Works across **every site tab** (general, content, brand, products, rentals, accounting
   reads…), with special depth on **inventory**: everything the map editor and the schematic
   editor can do today, because that is the steepest learning curve.
2. Accepts **company documents** (PDF / images / DOCX) and puts the facts where they belong
   (account/company, site fields, hours, prices, products, rentals) — after review.
3. Accepts **photos** to place anywhere on request (cover, product, rental item, brand logo /
   background, schematic underlay), or to **extract a layout**: aerial/drone photo → sunbed
   parcels on the map; drawn/printed plan → schematic elements + parcels.

Principle carried from track 027: **the model does not draw the beach.** It returns structured
intent; deterministic server code (`syncChairsWithLayout`, `generateChairGrid`, schematic
actions) produces the geometry, and every write is a reviewed proposal.

## Resume here

- **State 2026-10-11:** **all slices S0–S8 built — uncommitted** on `main`'s working tree (plus
  docs pass: `apps/partner/{CLAUDE,TESTING}.md`, `packages/data/CLAUDE.md`, root `CLAUDE.md`, wiki
  `subsystems/partner-assistant.md`). Only S7e's eval harness remains unbuilt.
- **Before any push:** `cd packages/data && npm run migrate:test` — applies BOTH migrations
  `20261011064712_assistant_models` and `20261011083109_assistant_upload_aerial_georef` to the Neon
  test DB (the pre-push hook blocks otherwise). Commit is founder-requested only.
- **Founder actions:** (1) connect private Blob store `sunbnb-private-blob` to the partner Vercel
  project with env prefix `ASSISTANT_BLOB` (→ `ASSISTANT_BLOB_READ_WRITE_TOKEN`); (2) add
  `COASTLINE_POSTGRES_URL`, `ANTHROPIC_API_KEY`, `PARTNER_ASSISTANT_ENABLED=1` to partner Vercel envs;
  (3) review `/legal/privacy` §5 wording + the ES/FI assistant strings; (4) decide the satellite
  toggle during photo alignment (D9 / 027 D8); (5) single composite plan card vs separate ordered cards (S8).
- **Open items:** €2/day cost cap not enforced (usage recorded on the conversation + `aerial.usage`
  on the upload; only turn caps bite); consent version on first use not recorded (`recordConsent`
  unused); brand logo/bg have no Brand-tab UI; upload-serving path bypasses the kill switch; aerial
  apply facing/head-feet check on a REAL parcel/photo; eval harness `packages/agent/eval/vision`
  (S7e, shared with 027 P11) not built; `AGENTS.md` (untracked) deliberately excluded from this work.
- **Context needed:** this file; `apps/partner/CLAUDE.md` § AI assistant; `.claude/wiki/subsystems/partner-assistant.md`;
  `.claude/rules/{architecture,auth,data-access,migrations}.md`.

## Decisions (Claude defaults 2026-10-11 — founder may override)

- **D1 Models:** chat + tool loop `claude-sonnet-5-5` (effort low–medium); layout/schematic
  extraction `claude-opus-5-5` (effort high); document extraction Sonnet 5.5. Confirm ids/prices
  against the claude-api reference before shipping. `tool_choice: auto` + `strict` tools;
  history append-only (Opus thinking cannot be disabled).
- **D2 Always confirm — SUPERSEDED 2026-10-11 by the founder ("I don't think we need previews, just do what is asked").**
  Now **act immediately with Undo**: every `propose_*` / `run_js` / plan / photo tool creates the
  `AssistantAction` and applies it in the same tool call through `applyProposal` (same auth, stale
  check, snapshot, 24 h undo), emitting the card as `status: applied`. Exceptions stay proposals with
  the typed `DELETE` confirmation (not undoable): any diff with `deletes` (propose_delete, shrinking
  a parcel, removing products / rental items / layout elements, also inside batches). At most 5
  actions applied per turn; a relative move < 0.5 m (or an already-met target) is refused so the
  model reports the state instead. Ghost previews now exist only for pending deletes. Original text:
  every write a proposal the user applies, no auto-apply in v1.
- **D3 Documents:** PDF, JPEG/PNG/HEIC, DOCX (text via mammoth). Never written from a document:
  IBAN/bank account, payment provider, KYC, Verifactu grants, personal ID numbers.
- **D4 UI:** right-side drawer in the site shell (`site-view.tsx`), persistent across tabs,
  full-screen sheet on phones; ghost-overlay previews in the inventory map / schematic canvas.
- **D5 Language:** replies in the user's language (EN/ES/FI); knowledge doc in EN; UI strings via
  next-intl.
- **D6 Access:** free during rollout behind a new account-scoped feature flag `assistant`
  (sudo always on); plan-gating decided later.
- **D7 Limits / kill switch:** per-account 30 turns / 10 min, 150 turns/day, €2/day from
  recorded usage, 10 extraction jobs/day; global `PARTNER_AI_DAILY_TURNS` (0 = off);
  `PARTNER_ASSISTANT_ENABLED` env + `ANTHROPIC_API_KEY` presence + the flag. One team email when
  the budget trips (pattern: marketing `notifyAiBudgetReached`).
- **D8 Privacy:** Anthropic named as sub-processor in `/legal/privacy` (+ merchant agreement
  annex later); uploads purged 30 days after upload or 24 h after the proposal resolves;
  `AssistantAction` 90 days; conversations 12 months; consent version recorded on first use.
- **D9 Imagery:** partner's own photos only (upload terms: partner may use the photo); never
  derive layouts from Google satellite tiles (027 D8 licensing gate). No site gallery (not an
  assistant feature).
- **D10 Undo:** snapshot undo for 24 h, refused if rows changed since apply; deletes not undoable.

## Architecture (summary of the 2026-10-11 design)

- **`packages/agent` (`@repo/agent`)** — provider-neutral, Prisma-free: `model.ts` +
  `claude-model.ts` moved from marketing (add streaming callbacks; fix the capability regex that
  misses `haiku-5-5`), generic `loop.ts`, `limits.ts` (generic AI budget over
  `@repo/data/rate-limit-shared`), later `vision/` and `geo/` (moved from marketing
  `beach-layout.ts`, `land-fit.ts`, `coastline.ts`, shared with 027 P11). Marketing becomes a
  thin wrapper; its tests/eval stay green unmodified. Pin `@anthropic-ai/sdk` to marketing's range.
  NOT in `@repo/data` (would ripple the SDK into every app + every `__mocks__/@repo/data`).
- **Persistence (additive migration):** `AssistantConversation`, `AssistantAction` (proposal:
  kind, payload, preview, before-snapshot, status proposed|applied|undone|expired|rejected,
  actor + impersonator), `AssistantUpload`; readers/writers in `packages/data/src/assistant.ts`.
- **Partner:** `apps/partner/lib/assistant/` (tool registry, per-domain tools, system prompt,
  knowledge doc), `app/api/assistant/route.ts` (SSE), `app/assistant/actions.ts`
  (apply/reject/undo/upload).
- **Auth on every tool:** `siteId` bound at the route, never from the model; `requireSiteOwner`
  per call; `assertOwned(siteId, kind, ids)` for every model-supplied id (closes the id-only /
  no-sudo checks in `setItemStatusByGroup`, `getItemGroup`, `saveInventoryItemLocation`,
  `saveInventoryItemProperties`, `deleteInventoryItem`, `updateLayoutElement`,
  `deleteLayoutElement`). Model-facing handles = parcel numbers, seat labels, names — not cuids.
  Every new route/action registered in `app/test/gated-actions.ts`.
- **Server compositions first:** parcel rotate / re-config / unit rotate live only in
  `inventory/view.tsx` + `ParcelForm.tsx` + `useSunbedEditing.ts` today → new
  `inventory/parcel-ops.ts` (`rotateParcel`, `applyParcelConfig`, `rotateUnit`) used by BOTH the
  editor and the agent; pure previews (`previewRotate/Spacing/Move`) in `@repo/schematic`.
- **Missing writers to add:** brand logo/bg (`SiteBrand.logoUrl/bgImageUrl`), rental item image,
  schematic underlay (`Site.bgImageUrl`); account patch (today `submitForm` replaces 10 fields).
- **Caching:** tools → system → knowledge doc cached (1 h); per-turn page context after the
  breakpoint.

## Roadmap

- ✅ **S0 — Extract `@repo/agent`** (DONE 2026-10-11: model, claude-model w/ streaming callbacks + capability TABLE, loop, schema check, limits; marketing = thin wrapper, its 272 tests unmodified; one SDK copy) from marketing (model, claude-model + streaming callbacks,
  loop, limits); marketing becomes a thin wrapper; its tests + eval + browser chat unchanged.
- ✅ **S1 — Data + server compositions** (DONE 2026-10-11: migration `20261011064712_assistant_models` local+sunbnb_test — NOT yet on Neon test, run `migrate:test` before pushing main; `@repo/data/assistant` account-scoped helpers + CAS transitions; flag `assistant`; `inventory/parcel-ops.ts` rotateParcel/applyParcelConfig/rotateUnit used by BOTH editors, 15 parity integration tests. Known pre-existing bug kept for parity: `pairSeats` derived from `intraPairGap > 0` re-pairs an unpaired parcel on rotate/reorder — FIX IN S4): migration (3 models); `parcel-ops.ts` with the editor
  switched to it; pure previews; parity tests; gated-action registry.
- ✅ **S2 — Chat shell + read tools** (DONE 2026-10-11, browser-verified with live Sonnet 5.5: drawer pushes beside the map at lg+, full-screen sheet below; 14 read tools; knowledge docs inventory/schematic/site-tabs; limits; transcript GET. Open: consent version on first use; costEstimate for the €2/day cap; 1h cache TTL needs a @repo/agent option): `/api/assistant` SSE, drawer UI, page/selection context,
  read tools across tabs, `explain_feature` (inventory knowledge doc), flag + limits + kill switch.
- ✅ **S3 — Safe tab writes** (DONE 2026-10-11, browser-verified: price 9.10→9.50 apply→tab shows 9.5→undo 9.10. 7 propose tools, apply/reject/undo with order-independent stale check (jsonb loses key order — only integration caught it), account patch `updateAccountFields`, sudo bypass via lib/owner-or-sudo.ts for working-hours/products child actions; tabs resync via `useAssistantResync` + SiteContext merge (root cause: SiteProvider read props once)): `propose_*` for site fields, hours, brand, products, rentals,
  account patch; apply/reject/undo; proposal cards; refresh wiring.
- ✅ **S4 — Inventory + schematic tools** (DONE 2026-10-11: S4b ghost overlays on map + schematic, typed delete confirm, QR print; S4c schematic element proposals; browser-verified parcel create→apply 4040→4052→undo 4040; schematic preview not yet browser-verified): S4a SERVER DONE 2026-10-11 (uncommitted): `inventory_batch` proposal kind (`lib/assistant/proposals/inventory-sim.ts` + `handlers/inventory.ts`, tools in `tools/propose-inventory.ts`, `request_qr_print` + SSE `qr_print`), pure `inventory/geometry.ts` shared by the actions and the preview, pairing bug fixed (`parcelIsPaired`). S4b = map/schematic ghost-overlay + typed delete confirm + print-event wiring (UI). Original scope: every map/schematic operation as a proposal; ghost
  overlay preview; batch apply; QR-reprint warnings; `request_qr_print`; typed delete confirm.
- ✅ **S5 — Documents** (DONE 2026-10-11; S5b composer attachments — paperclip/drag/paste, chips, error mapping; browser-verified: test PDF → hours/price/phone proposals): S5a SERVER DONE 2026-10-11 (`app/assistant/upload-actions.ts` uploadAssistantFile — magic-byte sniff, ≤20 MB, Blob `assistant/{accountId}/{uuid}/{name}`, 30/day; route attachments ≤5 → PDF document / image / DOCX-text via mammoth; 10 attachment turns/day; purge cron `/api/cron/purge-assistant-uploads`; privacy §5 — wording needs founder review; HEIC likely unsupported by the model → ask for JPEG/PNG). S5b = composer UI. upload, extraction (PDF document blocks / images / DOCX text), review
  table, purge cron, privacy text.
- ✅ **S6 — Photo placement** (DONE 2026-10-11: `place_image` kind, targets cover/product/rental_item/brand_logo/brand_background/schematic_underlay by NAME; apply copies to public `sites/{id}/assistant/{uploadId}.{ext}` re-encoded ≤2400px, EXIF stripped; undo restores snapshot; card thumbnails via `GET /api/assistant/uploads/[id]` (account-scoped); per-target tab resync. Browser-verified cover apply/undo. Brand logo/bg have no Brand-tab UI yet): core (buffer) refactors of upload actions + the missing image
  writers; placement proposals.
- ✅ **S7 — Aerial photo → map layout** (DONE 2026-10-11; design `.claude/tracks/030-s7-aerial-plan.md`):
  S7a geo move (`git mv` marketing `coastline/beach-layout/land-fit` → `packages/agent/src/geo/`,
  `overpass.ts` → `@repo/data/coastline-overpass` + `coastline-lookup.ts shoreAround`); S7b pure core
  (`georef.ts`, `grid-fit.ts` `fitAerialDescriptor`, `vision/aerial-schema` + extract); S7c server —
  migration `20261011083109_assistant_upload_aerial_georef` (local + sunbnb_test; NOT yet Neon test),
  `POST /api/assistant/aerial/[uploadId]/extract`, `GET /api/assistant/uploads/[id]/image`,
  `saveUploadGeoref`, `request_photo_alignment` / `propose_layout_from_photo`, `lib/assistant/aerial/*`;
  S7d alignment UI (`PhotoAlignLayer` / `PhotoAlignToolbar` on `InventoryMap`). Browser-verified
  2026-10-11 with a synthetic top-down photo on a throwaway site: `align_photo` opens the overlay,
  extraction "Photo read", confirm → 2 parcels 3×16 paired at 90% confidence, ghost preview. Land
  check was skipped locally until `COASTLINE_POSTGRES_URL` was added to partner env. S7e: docs done;
  eval harness `packages/agent/eval/vision` not built.
- ✅ **S8 — Plan → schematic** (DONE 2026-10-11, browser-verified on a throwaway schematic site with a drawn plan + 10 m scale bar: canvas 60×45, SEA water + BAR at exact metres, 2 parcels × 3 rows × 12 paired = 72 seats, all applied. `extract_schematic_from_plan` in `lib/assistant/tools/extract-plan.ts` + pure `lib/assistant/plan-extraction.ts`; separate ordered cards per kind (canvas → elements → parcels → optional underlay) — founder may want ONE composite card; asks for a real dimension when no scale; counts 1 extraction job. Polish: cards show raw field keys (seatsPerRow/type)): vision elements + parcels in schematic metres; underlay.

Each slice: requirements-driven tests, meta-guards green, `migrate:check`, docs
(`apps/partner/CLAUDE.md`, `TESTING.md`, wiki), browser verification. Nothing pushed without
founder say-so.

## Log

- **2026-10-11** — Track created from founder brief ("AI assistant in the partner app: all site
  tabs with inventory focus, company documents, photos placed or turned into layouts; reuse the
  marketing agent"). Design pass by a Plan agent (capability inventory of every inventory /
  schematic / tab operation → existing action; architecture; documents; photos; models/cost;
  slices). Findings: business logic lives in partner server actions (wrap, don't re-implement);
  several id-only auth checks without sudo bypass; parcel rotate/re-config are client-only
  compositions; no undo anywhere; four image destinations have no writer; track 029 (Next 16) is
  complete and doesn't conflict. Founder: "continue without my input, we can correct later" →
  D1–D10 taken as defaults.

- **2026-10-11** — S4–S6 landed via partner-dev agents; S5/S6 browser-verified (live Sonnet 5.5). Found + fixed: stale Content tab after place_image, raw URLs in cards. Uploads moved behind a dedicated private-store token.

- **2026-10-11** — S7 done (S7a–S7d), browser-verified with a synthetic aerial photo (2 parcels
  3×16 paired, 90% confidence, ghost preview). Docs pass: partner `CLAUDE.md` § AI assistant +
  `TESTING.md` assistant section, root `CLAUDE.md` env vars / `@repo/agent` / purge cron,
  `packages/data/CLAUDE.md` (assistant, coastline-lookup, coastline-overpass), wiki
  `subsystems/partner-assistant.md`. All slices built, nothing committed; push needs `migrate:test`
  for both migrations first.

## Open decisions

- Model/cost ceiling (D1, D7), IBAN from documents (D3),
  plan-gating (D6), DPA wording + retention (D8), EU inference (`inference_geo`), gallery (D9).

## Links

- [[track:027-beach-mockup-lead-agent]] — marketing agent (source of S0), P11 AI placement
  (shares S7 vision/geo), D8 imagery licensing gate
- [[track:020]] — large layouts (parcel tier payloads; preview must work at overview zoom)
- [[track:021]] — seat labels (renumbering → QR reprint warnings)
- [[subsystem:design-system]]

- **2026-10-11** — D2 superseded by the founder: act immediately with Undo (see Decisions). `proposals/act.ts`
  `createAndApply` (create + `applyProposal(id, {note:false})` + emit applied card), 5/turn cap, deletes stay pending,
  negligible-move guard in `inventory-sim.ts` (`MIN_MOVE_M`), ghost layer only for pending deletes, moved-parcel
  ghost streak fixed (one group connector instead of one arrow per seat). Tool names stay `propose_*` (renaming
  would ripple through prompt/inspect/OP_META; descriptions say they apply).
