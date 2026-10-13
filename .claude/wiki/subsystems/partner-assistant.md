---
type: subsystem
slug: partner-assistant
status: draft
sources:
  - apps/partner/lib/assistant/proposals/registry.ts
  - apps/partner/lib/assistant/proposals/act.ts
  - apps/partner/lib/assistant/proposals/lifecycle.ts
  - apps/partner/app/api/assistant/route.ts
  - apps/partner/app/assistant/actions.ts
  - apps/partner/lib/resync.ts
  - packages/data/src/assistant.ts
  - packages/agent/src/index.ts
related:
  - subsystem:schematic-editor
  - subsystem:auth
  - subsystem:design-system
last_verified: 2026-10-13
---

# Subsystem: Partner AI Assistant

A chat drawer in the partner site shell (track 030) that reads every site tab and **changes** (act-immediately with Undo since 2026-10-11; only deletes wait for a typed confirmation — `proposals/act.ts`)
writes — site fields, hours, brand, products, rentals, account, inventory parcels, schematic
elements, image placement — plus three vision flows: company documents → field proposals, drawn
plan → schematic, aerial photo → map parcels. Boundary: the model produces *intent*; existing
partner server actions and pure geometry produce every write. Surface detail (routes, env, tool
names) is canonical in `apps/partner/ASSISTANT.md` (pulled sibling of `apps/partner/CLAUDE.md`); this page is the mental model.

## Layers

| Layer | Where | Role |
|---|---|---|
| Agent core | `packages/agent` (`@repo/agent`) | Provider-neutral, Prisma-free: model adapter (`claude-model`, streaming callbacks), tool `loop`, AI-turn `limits`, `vision/` (aerial descriptor schema + extract), `geo/` (coastline, beach layout, land fit, `georef`, `grid-fit`). Shared with the marketing agent (track 027) — NOT in `@repo/data`, so the SDK doesn't ripple into every app and mock |
| Persistence | `@repo/data/assistant` | `AssistantConversation` (append-only messages + usage), `AssistantAction` (the proposal), `AssistantUpload` (+ `georef`, `aerial` jsonb). Account-scoped readers, CAS status transitions |
| Partner server | `apps/partner/lib/assistant/` | System prompt + knowledge docs, tool registry, proposal kind handlers, uploads, aerial plan, limits/config |
| Transport | `app/api/assistant/route.ts` (SSE) | One user turn per POST; tools emit `proposal` / `qr_print` / `align_photo` cards mid-turn |
| Apply | `app/assistant/actions.ts` | Apply / reject / undo — a separate, re-authorised server action, never the model |
| UI | `components/assistant/`, inventory `GhostLayer` / `PhotoAlign*` | Drawer, proposal cards, ghost previews, photo alignment overlay |

## Proposal lifecycle

`propose_*` tool → handler validates against the **same bounds the real action enforces**
(`validator-parity.test.ts`) → stores `AssistantAction{kind, payload, preview, status: proposed}` →
card. **Since 2026-10-11 (D2 superseded) the tool applies it immediately**: `proposals/act.ts` `createAndApply` runs `applyProposal` in the same call and emits the card as `applied` (Undo available); only a diff with `deletes` stays `proposed` behind the typed confirm; ≤5 applied per turn. Apply (button or auto) re-runs `requireSiteOwner`, re-diffs against current rows (stale → refused), snapshots
`before`, executes through the existing partner action, CAS `proposed → applied` (all in
`proposals/lifecycle.ts`). The stale check compares `diffBasis` (`proposals/types.ts`), which sorts
every list — `AssistantAction.payload` is jsonb and Postgres does not keep key order. Apply runs as
the proposal's `accountId` = the **site owner**, so a sudo's apply patches the owner's rows
(`applyAccountPatch(ctx.accountId, …)`, `lib/owner-or-sudo.ts` for child-row actions). Undo (24 h)
restores the snapshot only if the rows still match what apply wrote. Proposals expire after 1 h.
Kinds live in one registry (`proposals/registry.ts`); adding a capability = a new `KindHandler`
(validate · diff · execute · restore) + a `propose_*` tool + a gated-action entry if it adds an action.

## Vision flows

- **Documents** (PDF / image / DOCX-text) ride the chat turn as attachments → ordinary proposals.
- **Plan → schematic**: one structured extraction (`extract_schematic_from_plan`) → pure
  pixel→metre conversion (`plan-extraction.ts`) → ordered cards (canvas → elements → parcels → underlay).
- **Aerial → map**: the model returns a pixel-space `AerialDescriptorV1` (rows: endpoints + unit
  counts, not per-bed points); the human aligns the photo on the map (the georef — seeded from DJI
  XMP / EXIF / bed-size scale); `fitAerialDescriptor` converts rows → ENU → `ChairConfig` parcels,
  emitted as `inventory_batch` `create_parcel` ops, so preview/apply/undo are the inventory path
  unchanged. Extraction runs on its own route (300 s) in parallel with alignment and is cached on the upload.

## Invariants

1. **The model never writes and never draws.** Every write is a proposal applied by the user; geometry comes from `@repo/schematic` / `parcel-ops.ts` / `grid-fit`, never from model coordinates directly.
2. **`siteId` is bound by the route**, never accepted from the model; every tool re-checks `requireSiteOwner`; model-facing handles and proposal payloads are parcel numbers / seat labels / names, never a model-supplied cuid (where a payload must store an id, e.g. layout elements, it is resolved in-site at propose time and re-verified at execute).
3. **Handlers wrap existing server actions** (and `inventory/parcel-ops.ts`, shared with the map editor) — business rules are not re-implemented in `lib/assistant`.
4. **Uploads are private and transient**: private Blob store, 30-day purge. A placed image is COPIED to a public `sites/{id}/assistant/{uploadId}.{ext}` blob on apply, so site images never point at a purgeable upload.
5. **A billed extraction happens at most once per upload** (CAS claim; cached descriptor = no counters); refusals spend no budget.
6. **No Google satellite pixels reach the model** (027 D8 / 030 D9) — the partner's own photos only; human alignment is the georef.

## Related

- [[subsystem:schematic-editor]] — grid geometry the inventory/layout proposals reuse
- [[subsystem:auth]] — `requireSiteOwner`, sudo bypass (`lib/owner-or-sudo.ts`)
- Track: `.claude/tracks/030-partner-ai-assistant.md` (decisions D1–D10, open items); S7 design `030-s7-aerial-plan.md`

## Common pitfalls

- **Client tabs don't see an applied proposal.** `router.refresh()` never resets `useState`; a tab holding a client copy must subscribe with `useAssistantResync(kinds, refetch)` (`components/assistant/`) (`assistant:applied` event; `place_image:<target>` routes to one tab) and merge via `reconcileFields` so a field the user is editing is not clobbered.
- **Stale checks on jsonb compare key order.** Postgres jsonb does not keep key order — compare through `diffBasis`, never raw JSON (mocks pass; only the integration run showed every multi-field apply as `stale`).
- **A sudo apply writing the sudo's own rows.** Session-scoped writers (`updateAccountFields`, `syncChairsWithLayout('create')` stamping `session.user.id`) target the wrong account — route through owner-scoped writers keyed on `ctx.accountId`.
- **Snapshot tests that pass vacuously.** Prisma mocks must return *copies* from `findMany`; otherwise the `before` snapshot aliases live rows and undo assertions compare a row with itself.
- **Registering a new action/route** without `app/test/gated-actions.ts` or a reasoned `coverage-contract` exemption fails the meta-guards.
- **Pairing derived from gap > 0** re-paired an unpaired parcel on rotate — use `parcelIsPaired` (`inventory/parcel-config.ts`).
- **No `COASTLINE_POSTGRES_URL` in partner env** silently skips the aerial land check (a note, not an error).
