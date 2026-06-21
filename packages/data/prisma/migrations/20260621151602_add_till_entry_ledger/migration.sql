-- CreateTable
CREATE TABLE "till_entry" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "reservation_id" TEXT,
    "employee_id" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "settled_at" TIMESTAMP(3) NOT NULL,
    "voided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "till_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "till_entry_site_id_employee_id_settled_at_idx" ON "till_entry"("site_id", "employee_id", "settled_at");

-- CreateIndex
CREATE INDEX "till_entry_reservation_id_idx" ON "till_entry"("reservation_id");

-- AddForeignKey
ALTER TABLE "till_entry" ADD CONSTRAINT "till_entry_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "till_entry" ADD CONSTRAINT "till_entry_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "till_entry" ADD CONSTRAINT "till_entry_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: seed one TillEntry per existing cash walk-in reservation that has
-- not yet been covered. Idempotent: WHERE NOT EXISTS guard means a replay on a
-- fresh DB (or a re-run after partial failure) inserts each row at most once.
-- settledAt = reservation.created_at (best proxy for "when cash was taken").
-- gen_random_uuid() requires pgcrypto; use concat('te_', r.id) as a
-- deterministic id so the guard's NOT EXISTS is trivially cheap and replay-safe.
INSERT INTO "till_entry" ("id", "site_id", "reservation_id", "employee_id", "amount", "settled_at", "created_at")
SELECT
  concat('te_', r.id),
  r."site_id",
  r."id",
  r."employee_id",
  r."payment_amount",
  r."createdAt",
  NOW()
FROM "Reservation" r
WHERE r."status" = 'paid-in-cash'
  AND r."operational_status" = 'walked-in'
  AND r."payment_amount" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "till_entry" te WHERE te."reservation_id" = r."id"
  );
