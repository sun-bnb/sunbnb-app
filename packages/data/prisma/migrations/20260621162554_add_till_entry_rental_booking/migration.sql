-- AlterTable
ALTER TABLE "till_entry" ADD COLUMN     "rental_booking_id" TEXT;

-- CreateIndex
CREATE INDEX "till_entry_rental_booking_id_idx" ON "till_entry"("rental_booking_id");

-- AddForeignKey
ALTER TABLE "till_entry" ADD CONSTRAINT "till_entry_rental_booking_id_fkey" FOREIGN KEY ("rental_booking_id") REFERENCES "RentalBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: seed one TillEntry per existing cash walk-in rental booking that
-- has not yet been covered. Idempotent: WHERE NOT EXISTS guard means a replay
-- on a fresh DB (or a re-run after partial failure) inserts each row at most
-- once. No operational status filter: the old till counted ALL paid-in-cash
-- rentals regardless of operationalStatus (reserved/picked-up/returned), so
-- the backfill reproduces that behaviour exactly.
-- settledAt = rb.createdAt (best proxy for "when cash was taken").
-- Deterministic id concat('te_rb_', rb.id) so the idempotency guard is cheap
-- and the row can be identified unambiguously.
INSERT INTO "till_entry" ("id", "site_id", "rental_booking_id", "employee_id", "amount", "settled_at", "created_at")
SELECT
  concat('te_rb_', rb.id),
  rb."site_id",
  rb."id",
  rb."employee_id",
  rb."payment_amount",
  rb."createdAt",
  NOW()
FROM "RentalBooking" rb
WHERE rb."status" = 'paid-in-cash'
  AND rb."payment_amount" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "till_entry" te WHERE te."rental_booking_id" = rb."id"
  );
