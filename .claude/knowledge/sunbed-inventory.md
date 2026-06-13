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
- **Map & drag-and-drop** — `InventoryMap` projection, marker drag, marquee select, SchematicRenderer drag MIME — _none yet_
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

<!-- InventoryMap projection, marker drag, marquee select, SchematicRenderer drag MIME -->

## Auto-save & forms

<!-- debounced save, SaveStatus states, ElementPropertiesSidebar wiring -->

## Test failures & fixes

<!-- non-obvious mock setups, fixture issues for inventory actions tests -->

## Rejected approaches

<!-- Approaches tried and rejected — record so a future session doesn't re-try them -->
