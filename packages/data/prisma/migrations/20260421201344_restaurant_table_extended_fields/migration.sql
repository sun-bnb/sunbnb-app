-- Extend `restaurant_table` with the fields needed for reservation management
-- beyond the bare-bones MVP: physical size (so a 2-top renders smaller than an
-- 8-top), optional zone for sectioning, and a partner-internal staff note.
-- All additive; all defaulted or nullable.

ALTER TABLE "restaurant_table"
    ADD COLUMN "width" DOUBLE PRECISION NOT NULL DEFAULT 1.2,
    ADD COLUMN "height" DOUBLE PRECISION NOT NULL DEFAULT 1.2,
    ADD COLUMN "zone" TEXT,
    ADD COLUMN "staff_note" TEXT;
