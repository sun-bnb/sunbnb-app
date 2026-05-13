-- Optional per-side chair-count override on tables. All null = auto-distribute.

ALTER TABLE "restaurant_table"
  ADD COLUMN "seats_top"    INTEGER,
  ADD COLUMN "seats_right"  INTEGER,
  ADD COLUMN "seats_bottom" INTEGER,
  ADD COLUMN "seats_left"   INTEGER;
