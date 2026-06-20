-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "time_zone" TEXT;

-- CreateTable
CREATE TABLE "reservation_day" (
    "id" TEXT NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "operational_status" TEXT NOT NULL DEFAULT 'expected',
    "checked_in_at" TIMESTAMP(3),
    "departed_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservation_day_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reservation_day_date_idx" ON "reservation_day"("date");

-- CreateIndex
CREATE UNIQUE INDEX "reservation_day_reservation_id_date_key" ON "reservation_day"("reservation_id", "date");

-- AddForeignKey
ALTER TABLE "reservation_day" ADD CONSTRAINT "reservation_day_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Backfill (idempotent) — track 012 P0 ───────────────────────────────────
-- Seed one reservation_day per civil date for every ACTIVE reservation that
-- runs today or later, so the per-day operational model has rows for the
-- bookings currently on the floor. Today's row inherits the parent's current
-- operational state (so an already-checked-in multiday guest stays checked-in
-- today); future rows start 'expected'. Past dates are never seeded
-- (GREATEST(from, today)). Re-runnable: the unique (reservation_id, date) +
-- ON CONFLICT DO NOTHING make replays a no-op (required for fresh-DB replay).
--
-- NOTE: this seed uses CURRENT_DATE (server/UTC) — an acceptable approximation
-- for a one-time backfill. Venue-local day precision applies to the live
-- read/write path (P1, via @repo/data/site-day), not this seed.
INSERT INTO "reservation_day" (
  "id", "reservation_id", "date",
  "operational_status", "checked_in_at", "departed_at",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  r."id",
  d::date,
  CASE WHEN d::date = CURRENT_DATE THEN r."operational_status" ELSE 'expected' END,
  CASE WHEN d::date = CURRENT_DATE THEN r."checked_in_at"      ELSE NULL END,
  CASE WHEN d::date = CURRENT_DATE THEN r."departed_at"        ELSE NULL END,
  now(),
  now()
FROM "Reservation" r
CROSS JOIN LATERAL generate_series(
  GREATEST(r."from"::date, CURRENT_DATE),
  r."to"::date,
  interval '1 day'
) AS d
WHERE r."status" NOT IN ('canceled', 'refunded')
  AND r."to"::date >= CURRENT_DATE
  -- Blocked (out-of-service) beds use a far-future sentinel `to` (year 2999) and
  -- are STICKY — they derive their bed state from the parent, not per-day rows
  -- (track 012 design D5). Excluding them also avoids a generate_series explosion
  -- of ~355k rows from one blocked reservation.
  AND r."operational_status" <> 'blocked'
ON CONFLICT ("reservation_id", "date") DO NOTHING;
