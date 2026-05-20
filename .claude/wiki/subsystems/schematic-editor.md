---
type: subsystem
slug: schematic-editor
status: draft
sources:
  - packages/schematic/src/grid.ts#generateChairGrid
  - packages/schematic/src/grid.ts#generateTableGrid
  - packages/schematic/src/SchematicRenderer.tsx
  - packages/schematic-editor/src/index.ts
  - apps/partner/app/sites/[id]/inventory/chair-util.ts#generateChairs
  - apps/partner/app/sites/[id]/inventory/InventoryMap.tsx#getScaledSize
  - apps/partner/app/sites/[id]/inventory/actions.ts#moveParcel
  - packages/table-reservations-ui
related: []
last_verified: 2026-05-20
---

# Subsystem: Schematic Editor

The shared geometry + editor layer behind every grid-of-things UI. Two packages,
two consumers. Brand- and product-neutral: the beach **sunbed inventory** editor
(`apps/partner`) and the **restaurant tables** editor (`@repo/table-reservations-ui`)
both compose the same pieces, and the user-app sunbed *selection* UI renders from
the same geometry.

## Package matrix

| Package | Contains | Has business logic? |
|---|---|---|
| `@repo/schematic` | Pure geometry (`grid.ts`), SVG renderer (`SchematicRenderer.tsx`), glyphs (`chair-glyphs.ts`), types | No — pure functions + presentational React |
| `@repo/schematic-editor` | Brand-neutral editor chrome (save banner, canvas header, properties sidebar, keyboard) | No — UI primitives only |

Neither package touches the DB or Prisma. Consumers own persistence, auth, and
coordinate placement.

## Grid generation (pure)

`generateChairGrid(config)` and `generateTableGrid(config)` in `packages/schematic/src/grid.ts`
produce **dx/dy meter deltas from an origin** — they do *not* decide where the grid
lives in the world. The caller maps the deltas to either:

- **Map (geographic) coordinates** — `generateChairs()` in `chair-util.ts` adds `dy/metersPerLat`, `dx/metersPerLng` to a base lat/lng.
- **SVG schematic coordinates** — `generateChairsSchematic()` adds `dx`, `dy` to a base X/Y.

`pairSeats: true` emits seats two at a time sharing `intraPairGap`; the primary carries
`isPrimary: true` and points at its partner via `pairTempId` (bidirectional).

## Coordinate systems — the Y-axis trap

Grid math is written **Y-up** (geographic: +dy = north = up-on-screen). SVG is **Y-down**
(+y = down-on-screen). So `generateChairsSchematic()` calls `generateChairGrid` with the
**inverse** rotation (`-config.rotation`) and then re-applies the original rotation to each
seat, so a "+rotation" parcel turns clockwise on *both* the map editor and the SVG schematic.
See `chair-util.ts#generateChairsSchematic` for the full comment. **Any new schematic
consumer must respect this sign flip** or rotations mirror.

## Sizing — one source of truth

`SUNBED_HEIGHT = 2.1` (meters) and `SUNBED_WIDTH = 2.1 / 2.5` live in `packages/schematic/src/grid.ts`
and are re-exported through `chair-util.ts`. The map editor converts meters → pixels per
zoom via `getScaledSize(zoom)` in `InventoryMap.tsx` (`2.1 / metersPerPixel`, floored at a
minimum px). Restaurant tables size from `TABLE_SHAPE_DEFAULTS` / explicit `tableWidth`/`tableHeight`.

## Parcels / groups

Items are grouped by an integer `group` (1+; 0/undefined = ungrouped). Colour comes from
`getParcelColor(group)` → `PARCEL_COLORS[(group-1) % 8]` (`chair-util.ts`). Partner-side group
operations live in `apps/partner/app/sites/[id]/inventory/actions.ts`:

- `moveParcel(...)` — drag any member, the whole group shifts by the same lat/lng delta
- `moveItems(...)`, `rotateSelection(...)`, `adjustItemSpacing(...)` — bulk transforms over a selection
- `assignItemsToGroup` / `removeItemsFromGroup` / `setItemStatusByGroup` — membership + status
- `syncChairsWithLayout(siteId, config, mode)` — regenerate a parcel's layout from a `ChairConfig`

## Shared editor chrome (`@repo/schematic-editor`)

Exported from `packages/schematic-editor/src/index.ts`:

- `SaveStatusBanner` (+ `SaveStatus` type) — the idle/saving/saved indicator for debounced auto-save
- `CanvasDimensionsHeader` — canvas size readout
- `ElementPropertiesSidebar` — the overlay properties panel (label, price, rotation, category…)
- `useEditorKeyboard` — selection/keyboard shortcut hook (delete, deselect, nudge)

The `SchematicRenderer` (+ `SCHEMATIC_DRAG_MIME`) from `@repo/schematic` draws the SVG canvas
and handles drag MIME for drag-and-drop.

## Invariants

1. **Geometry is pure.** `grid.ts` does no IO; never add DB/auth there. Placement + persistence belong to the consumer.
2. **One sizing constant.** Change `SUNBED_HEIGHT` in `grid.ts` only; never hardcode a sunbed dimension in a component.
3. **Rotation sign flips for SVG.** Map = Y-up, schematic = Y-down (`generateChairsSchematic`).
4. **Parcel moves are group-atomic.** Dragging one member moves the whole `group` via `moveParcel`.
5. **Editor chrome is brand-neutral.** Keep product words (sunbed, table) out of `@repo/schematic-editor`; pass labels in as props.

## Consumers

The persisted sunbed rows this layer places live behind `apps/partner/app/sites/[id]/inventory-actions.ts`; the create/move/rotate parcel journey runs through `apps/partner/app/sites/[id]/inventory/actions.ts`. Restaurant tables consume the same geometry via `packages/table-reservations-ui`. (Dedicated `inventory-item` / `parcel-edit` wiki pages are future candidates — add `related:` links when they exist.)

## Common pitfalls

- **Hardcoding a pixel size** instead of going through `getScaledSize()` — markers desync from the generated grid on zoom.
- **Forgetting the rotation sign flip** when adding an SVG consumer — parcels render mirrored vs the map editor.
- **Mutating one paired seat** without its partner (`pairTempId`) — leaves a half-pair.
- **Adding business logic to `@repo/schematic`** — it must stay pure; auth/DB go in the consuming app's actions.
- **Treating `group` 0 as a real parcel** — 0/undefined means ungrouped; `getParcelColor` returns undefined for it.
