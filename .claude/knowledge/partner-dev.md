# partner-dev playbook

`partner-dev`'s curated, growing memory for `apps/partner`. Governed by
`.claude/knowledge/README.md` (layer spec + trust ladder). Grow it via the gated
retrospective; curate it via `workflows/groom.md`.

## Navigation index

What this playbook knows, by theme. Maintained by grooming; scan it before reading
sections. *(Empty — entries are added as the agent learns. Each entry: a one-line
pointer here + the full entry in its section below.)*

- **Auth & ownership** — `requireSiteOwner` / `verifySiteOwnership` / sudo edge cases — _none yet_
- **State machines** — order / operational / rental transition gaps — _none yet_
- **Test failures & fixes** — mock/fixture gotchas — _none yet_
- **Bug patterns & fixes** — recurring partner-app bugs — _none yet_
- **Rejected approaches** — dead-ends, so nobody re-tries them — _none yet_

---

## Auth & ownership

<!-- Entry format:
### YYYY-MM-DD: <concise title>
**Problem:** what went wrong / what was non-obvious
**Solution:** what actually worked
**Prevention:** how a future session avoids it (cite path/file.ts#symbol) -->

## State machines

<!-- Order status, operational status, rental status — unexpected transitions or gaps -->

## Test failures & fixes

### 2026-06-14: saveInventoryItemProperties dual-write mock exhaustion
**Problem:** Adding SunbedGroup dual-write to `saveInventoryItemProperties` added 3 extra `prisma.inventoryItem.findUnique` calls (fetch `sunbedGroupId` for current item, for pair, then re-fetch `siteId` for group creation). Existing test only mocked 3 calls; the 4th–6th returned `undefined`, crashing with `TypeError: Cannot read properties of undefined (reading 'id')` on `newGroup.id`.
**Solution:** Extend the `mockResolvedValueOnce` chain to cover all sequential `findUnique` calls in order, plus mock `prisma.sunbedGroup.create` and `prisma.inventoryItem.updateMany`.
**Prevention:** When a server action calls `findUnique` multiple times in sequence, count them carefully and chain `mockResolvedValueOnce` for each. Any un-mocked call returns `undefined` (not throws), so the crash can appear far from the missing mock.

## Bug patterns & fixes

<!-- Recurring bug shapes specific to apps/partner -->

## Rejected approaches

### 2026-06-15: React onWheel prop for wheel zoom (passive listener no-op)
**Problem:** React's synthetic `onWheel` prop attaches a passive listener. Calling `e.preventDefault()` inside it is silently ignored by the browser — the native page zoom fires anyway (and on macOS, ctrl+wheel triggers OS-level zoom).
**Solution:** Register via `el.addEventListener('wheel', handler, { passive: false })` inside a `useEffect` on the element ref, with cleanup `removeEventListener`. This is what `SchematicRenderer.tsx` does (lines 340–363).
**Prevention:** Any time you need to `preventDefault()` on a wheel event, skip `onWheel` prop and use the manual `addEventListener` pattern. The eslint-disable comment on the empty dep array is standard for this pattern — the handler reads a ref, not state.
