-- Batch A: per-table booking rules + canvas lock.
-- All columns are nullable or defaulted, so no backfill is required.

ALTER TABLE "restaurant_table"
  ADD COLUMN "max_party_size"     INTEGER,
  ADD COLUMN "online_bookable"    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "turn_time_minutes"  INTEGER,
  ADD COLUMN "locked"             BOOLEAN NOT NULL DEFAULT FALSE;
