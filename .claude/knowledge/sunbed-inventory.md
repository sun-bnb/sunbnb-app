# sunbed-inventory playbook

`sunbed-inventory`'s curated, growing memory for the partner sunbed inventory editor and
the shared schematic layer it builds on. Governed by `.claude/knowledge/README.md` (layer
spec + trust ladder). Grow it via the gated retrospective; curate it via
`workflows/groom.md`. Learnings about the shared layer itself → propose a `/wiki ingest`
of `subsystems/schematic-editor.md`.

## Navigation index

What this playbook knows, by theme. Maintained by grooming; scan it before reading
sections. *(Empty — entries are added as the agent learns.)*

- **Coordinate & geometry** — geo↔pixel, Y-up/Y-down rotation sign flip, `getScaledSize`/zoom — _none yet_
- **Parcel / group operations** — `moveParcel` atomicity, group membership, pairing (`pairTempId`/`isPrimary`) — _none yet_
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

<!-- moveParcel atomicity, group membership, bulk transforms, pairing (pairTempId/isPrimary) -->

## Map & drag-and-drop

<!-- InventoryMap projection, marker drag, marquee select, SchematicRenderer drag MIME -->

## Auto-save & forms

<!-- debounced save, SaveStatus states, ElementPropertiesSidebar wiring -->

## Test failures & fixes

<!-- non-obvious mock setups, fixture issues for inventory actions tests -->

## Rejected approaches

<!-- Approaches tried and rejected — record so a future session doesn't re-try them -->
