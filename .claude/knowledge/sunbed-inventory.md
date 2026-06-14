# sunbed-inventory playbook

`sunbed-inventory`'s curated, growing memory for the partner sunbed inventory editor and
the shared schematic layer it builds on. Governed by `.claude/knowledge/README.md` (layer
spec + trust ladder). Grow it via the gated retrospective; curate it via
`workflows/groom.md`. Learnings about the shared layer itself → propose a `/wiki ingest`
of `subsystems/schematic-editor.md`.

## Navigation index

What this playbook knows, by theme. Maintained by grooming; scan it before reading
sections.

- **Coordinate & geometry** — geo↔pixel, Y-up/Y-down rotation sign flip, `getScaledSize`/zoom — _none yet_
- **Parcel / group operations** — `moveParcel` atomicity, group membership, pairing (`pairTempId`/`isPrimary`), seat-number encoding, reversal action — [2026-06-13: Seat number encoding & reversal](#2026-06-13-seat-number-encoding--reversal-action)
- **Map & drag-and-drop** — `InventoryMap` projection, marker drag, marquee select, SchematicRenderer drag MIME — [2026-06-14: Group-first pairId migration in rotate hook and schematic drag-persist](#2026-06-14-group-first-pairid-migration-in-rotate-hook-and-schematic-drag-persist), [2026-06-14: Migrating SchematicRenderer drag co-move from pairId to groupId](#2026-06-14-migrating-schematicrenderer-drag-co-move-from-pairid-to-groupid)
- **Auto-save & forms** — debounced save, `SaveStatus` states, sidebar wiring — _none yet_
- **Test failures & fixes** — mock setups, fixture issues for inventory actions tests — _none yet_
- **Rejected approaches** — dead-ends, so nobody re-tries them — _none yet_

---

## Coordinate & geometry

<!-- Entry format:
### YYYY-MM-DD: <concise title>
**Problem:** what went wrong / what was non-obvious
**Solution:** what actually worked
**Prevention:** how a future session avoids it (cite path/file.ts#symbol) -->

<!-- geo↔pixel transforms, the Y-up/Y-down rotation sign flip, getScaledSize/zoom scaling -->

## Parcel / group operations

### 2026-06-13: Seat number encoding & reversal action

**Problem:** Operators need to flip seat numbering direction without moving beds physically. The naive approach — re-running `generateChairGrid` with a flipped flag — repositions beds because `syncChairsWithLayout` matches existing items to generated positions **by `number`**.

**Solution:** `reverseParcelNumbering(siteId, group)` in `actions.ts`:
- Fetches only `{ id, number }` (coordinates not needed).
- Groups items by row prefix = `String(number).slice(0, -2)` (seat suffix is always the last 2 digits per `generateChairGrid`: `Number(`${group}${rowNum2}${seatNum2}`)` ).
- For each row, sorts ascending and remaps position `i` to the seat suffix from position `n-1-i`.
- Writes all updates in a single `prisma.$transaction([...updates])` pass — no temp-offset needed because `InventoryItem.number` has **no unique constraint** per site (schema confirmed: no `@@unique([siteId, number])`).
- `pairId` is by item `id`, not number, so physical pairings survive automatically.

**Gotcha — manage-grid parity:** `Item.tsx:62` uses `item.number % 2 !== 0` for the visual intra-pair gap. After reversal, parity within each pair flips (bed that was odd becomes even). The pair grouping visual still holds (the two beds in each pair still have numbers differing by 1, one odd + one even), but the gap appears on the opposite side of each bed. Cosmetic asymmetry, not a functional break.

**File placement rule:** `actions.ts` = bulk/group geometry operations (`moveParcel`, `rotateSelection`, `reverseParcelNumbering`). `inventory-actions.ts` = per-item CRUD (`createInventoryItem`, `saveInventoryItemProperties`, etc.).

**Prevention:** When adding any "relabel in place" action, confirm schema for uniqueness constraints before choosing single-pass vs temp-offset strategy. Check `schema.prisma` lines 293-321 for `InventoryItem`.

## Map & drag-and-drop

### 2026-06-14: Group-first pairId migration in rotate hook and schematic drag-persist

**Problem:** Two remaining `pairId`-only readers in the partner editors found "the partner" via `pairId` scalar only, so they silently broke for N-member SunbedGroups (only the `pairId` partner was co-rotated / co-saved on drag, not all group members).

**Targets:**
1. `rotateSingle` in `inventory/useSunbedEditing.ts` — signature changed from `partnerId?: string | null` to `partnerIds: string[] = []`. `rotateSelection(siteId, [itemId, ...partnerIds], delta)` when `partnerIds.length > 0`, else single-item `saveInventoryItemProperties` path.
2. `handleRotateSingleItem` in both `inventory/view.tsx` and `schematic/view.tsx` — group-first resolution: `inventory.filter(i => i.sunbedGroupId === selectedItem.sunbedGroupId && i.id !== selectedItemId)`. pairId fallback only when `partnerIds.length === 0` (pushes the single legacy `pairId ?? pair?.id ?? pairedBy?.id` as a 1-element array).
3. `handleItemDragEnd` in `schematic/view.tsx` — same group-first / pairId-fallback pattern. `Promise.all([save dragged, ...groupPartners.map(save partner + offset)])` generalizes to N members.

**Maps drag (`handleMarkerDragEnd` in `inventory/view.tsx`) was confirmed group-move-only** — uses `moveParcel(siteId, item.group, deltaLat, deltaLng)` for grouped items, no pairId-based pair-follow. No change needed there.

**Pattern that worked cleanly:** The group-first resolution is 3 lines in every call site — filter inventory in-memory by `sunbedGroupId`, map to ids, push legacy `pairId` as fallback only when the slice is empty. No helper function needed (duplication is justified by clarity at each call site).

**Prevention:** When looking for remaining `pairId` reader sites, grep for `pairId ??` — the `??`-chain pattern `pairId ?? pair?.id ?? pairedBy?.id` is the reliable fingerprint of a legacy-only reader.

### 2026-06-14: Migrating SchematicRenderer drag co-move from pairId to groupId

**Problem:** The schematic editor's drag co-move logic (partner follows dragged item) was keyed on `pairId` — a domain-specific field that encodes visual pairing. When `SunbedGroup` became the persistence source of truth for "items that move together", the drag logic needed to switch sources without touching the visual highlight code (which stays on `pairId`).

**Solution:** Added a generic `groupId?: string | null` field to `SchematicItem` (in `packages/schematic/src/types.ts`). The renderer is intentionally domain-agnostic: "items sharing `groupId` move together on drag". `SchematicCanvas.tsx` (`apps/partner/app/sites/[id]/schematic/SchematicCanvas.tsx`) populates it from `item.sunbedGroupId`. Tables never set it.

**Two drag sites in SchematicRenderer.tsx — both must be updated:**
1. `handleUp` callback (line ~239) — commits `pendingItemDrops` with co-mover positions on mouse-up.
2. Render-time IIFE (line ~810) — computes live preview offsets during the active drag (`followDrag` flag). Missing either makes the visual preview and the committed position diverge.

**Tables are a verified no-op:** `TableLayoutEditor.tsx` and `FloorMapPicker.tsx` build `SchematicItem[]` without `pairId` or `groupId` — confirmed by grep. The `groupId` field is optional (`undefined`), so existing consumers need no change.

**pairId highlight code is untouched:** `isPaired = !!item.pairId` and `pairedSelected` border logic still read from `pairId` exactly as before. The migration is drag-only.

**Prevention:** When extending SchematicRenderer drag behavior, remember there are TWO independent drag sites in the same file — grep for both `pendingItemDrops` and `isDragCoMover`/`followDrag` to find them.

## Auto-save & forms

<!-- debounced save, SaveStatus states, ElementPropertiesSidebar wiring -->

## Test failures & fixes

<!-- non-obvious mock setups, fixture issues for inventory actions tests -->

## Rejected approaches

<!-- Approaches tried and rejected — record so a future session doesn't re-try them -->
