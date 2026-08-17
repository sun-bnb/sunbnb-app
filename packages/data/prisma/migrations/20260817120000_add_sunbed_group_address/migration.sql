-- Track 021 — complete the unit ADDRESS on SunbedGroup.
--
-- `seq` already lived here; `parcel` and `row_idx` were scattered across the
-- unit's members (InventoryItem.group, and the row encoded inside
-- InventoryItem.number). Bringing them onto the unit is what makes the address
-- constrainable — a unique index cannot span two tables — and lets a device
-- assignment resolve by index instead of a parcel-wide scan plus a JS filter.
--
-- Additive and nullable: no running code reads these yet, and every existing
-- row stays valid. The backfill populates them from the SAME derivation the
-- labels already use, so no address anywhere changes on release. The
-- UNIQUE(site_id, parcel, row_idx, seq) constraint lands in a LATER migration,
-- once the backfill is verified in each environment.
--
-- `row_idx` rather than `row`: ROW is a reserved word in Postgres, and this
-- table is touched by hand-written SQL in the inventory editor.
ALTER TABLE "SunbedGroup" ADD COLUMN     "parcel" INTEGER,
ADD COLUMN     "row_idx" INTEGER;
