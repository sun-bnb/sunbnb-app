---
description: Prime for schematic-based UI work (sunbed/table grid editors) — loads the shared geometry + editor-chrome capability
argument-hint: "[sunbed-inventory | sunbed-selection | table-layout]"
---

# /schematic — shared schematic-UI capability

This is the **shared capability** behind every grid-of-things UI in the repo. Invoke it
before working on the sunbed inventory editor, the user sunbed-selection UI, or the
restaurant tables editor, so you load the geometry + editor knowledge **once, from one
source**, instead of re-deriving it. Any agent (a specialist, a generalist, or the main
session) can invoke it.

**Argument** (`$ARGUMENTS`, optional) — the consumer you're working on:
`sunbed-inventory` · `sunbed-selection` · `table-layout`. If omitted, load the general layer only.

## Load sequence

1. **Read the synthesis page first:** `.claude/wiki/subsystems/schematic-editor.md`. It is the
   canonical orientation — package matrix, the Y-axis rotation trap, sizing source of truth,
   parcels/groups, shared editor chrome, invariants, pitfalls.
2. **Read the geometry source it cites** as needed:
   - `packages/schematic/src/grid.ts` — `generateChairGrid`, `generateTableGrid`, `SUNBED_HEIGHT`, `TABLE_SHAPE_DEFAULTS` (pure, no IO)
   - `packages/schematic/src/SchematicRenderer.tsx` — SVG canvas + `SCHEMATIC_DRAG_MIME`
   - `packages/schematic-editor/src/index.ts` — `SaveStatusBanner`, `CanvasDimensionsHeader`, `ElementPropertiesSidebar`, `useEditorKeyboard`
3. **Then read the consumer-specific surface** for `$ARGUMENTS`:
   - `sunbed-inventory` → `apps/partner/app/sites/[id]/inventory/` (`view.tsx` orchestrator, `InventoryMap.tsx#getScaledSize`, `SunbedMarker.tsx`, `ParcelForm.tsx`, `InventoryForm.tsx`, `chair-util.ts`, `actions.ts`) + `app/sites/[id]/inventory-actions.ts`
   - `sunbed-selection` → `apps/user/components/reservation/` (SunbedSelection + geo/schematic variants) + `sitesSlice`/`reservationSlice`
   - `table-layout` → `packages/table-reservations-{core,ui}/` + `apps/partner/app/sites/[id]/restaurant/tables/` + `apps/user/app/sites/[id]/table/`

## Non-negotiables (full detail in the subsystem page)

- **Geometry stays pure** — never add DB/auth to `@repo/schematic`; placement + persistence belong to the consumer's server actions.
- **One sizing constant** — `SUNBED_HEIGHT` in `grid.ts`; never hardcode a sunbed dimension in a component (`getScaledSize` converts meters→px per zoom).
- **SVG rotation sign flips** — map is Y-up, schematic is Y-down (`generateChairsSchematic` uses `-rotation`).
- **Parcel moves are group-atomic** — drag one member, `moveParcel` shifts the whole `group`.
- **Editor chrome is brand-neutral** — keep "sunbed"/"table" words out of `@repo/schematic-editor`; pass labels as props.

## While you work

Follow `.claude/agent-protocol.md`: emit `kb:` markers for geometry/coordinate gotchas you
hit, and if you learn something durable about this layer, fold it back via `/wiki ingest`
(update `subsystems/schematic-editor.md`, bump `last_verified`, and promote it from `draft`
to `stable` once you've verified the cited sources).
