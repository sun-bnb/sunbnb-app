-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "table_reservation_id" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_table_reservation_id_idx" ON "Invoice"("table_reservation_id");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_table_reservation_id_fkey" FOREIGN KEY ("table_reservation_id") REFERENCES "table_reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the no-show-deposit ServiceCode so it surfaces in the admin fee-config UI.
-- The loadFeeContext bootstrap auto-creates a default fee for any unknown code,
-- so the cascade works even before admin configures a real amount; this row just
-- makes the code discoverable and configurable from the admin UI.
INSERT INTO "ServiceCode" (id, code, description, "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'no-show-deposit', 'No-show deposit kept by partner — platform commission deducted from deposit revenue', now(), now())
ON CONFLICT (code) DO NOTHING;
