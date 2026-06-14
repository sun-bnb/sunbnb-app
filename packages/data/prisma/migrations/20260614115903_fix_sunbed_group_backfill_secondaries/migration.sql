-- Fix the incomplete SunbedGroup backfill from migration
-- 20260614113530_add_sunbed_group.
--
-- That backfill only grouped the bed holding `pair_id` (the "primary"). Pairs
-- created by the inventory bulk-generator are ONE-DIRECTIONAL: only the primary
-- carries `pair_id`, while the "secondary" bed has `pair_id = NULL` and is linked
-- solely through the virtual `pairedBy` reverse-relation. The original
-- `WHERE pair_id IS NOT NULL` therefore matched only primaries, leaving every
-- secondary ungrouped and producing 1-member SunbedGroups instead of complete
-- 2-member groups.
--
-- Attach each orphaned secondary to its primary's existing group. Idempotent
-- (the `sec.sunbed_group_id IS NULL` guard makes replay a no-op) and safe on a
-- fresh DB, where it runs right after the original additive migration and its
-- 1-member groups.
UPDATE "InventoryItem" sec
SET sunbed_group_id = pri.sunbed_group_id
FROM "InventoryItem" pri
WHERE pri.pair_id = sec.id
  AND pri.sunbed_group_id IS NOT NULL
  AND sec.sunbed_group_id IS NULL;

-- Defensive cleanup: drop any SunbedGroup that still has no members (e.g. a
-- primary whose secondary row was deleted between the two migrations).
DELETE FROM "SunbedGroup" g
WHERE NOT EXISTS (
  SELECT 1 FROM "InventoryItem" i WHERE i.sunbed_group_id = g.id
);
