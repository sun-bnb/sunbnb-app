-- Step 1: Add new columns to Invoice (FK fields + Veri*factu fields)
ALTER TABLE "Invoice" ADD COLUMN "reservation_id" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "order_id" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "invoice_number" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "previous_hash" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "hash" TEXT;

-- Step 2: Add vatRate to InvoiceLine
ALTER TABLE "InvoiceLine" ADD COLUMN "vat_rate" DOUBLE PRECISION;

-- Step 3: Migrate existing FK data from Reservation/Order → Invoice
UPDATE "Invoice" SET reservation_id = r.id
FROM "Reservation" r WHERE r.invoice_id = "Invoice".id;

UPDATE "Invoice" SET order_id = o.id
FROM "Order" o WHERE o.invoice_id = "Invoice".id;

-- Step 4: Drop old FK constraints and columns from Reservation and Order
ALTER TABLE "Reservation" DROP CONSTRAINT IF EXISTS "Reservation_invoice_id_fkey";
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_invoice_id_fkey";

DROP INDEX IF EXISTS "Reservation_invoice_id_key";
DROP INDEX IF EXISTS "Order_invoice_id_key";

ALTER TABLE "Reservation" DROP COLUMN IF EXISTS "invoice_id";
ALTER TABLE "Order" DROP COLUMN IF EXISTS "invoice_id";

-- Step 5: Add new FK constraints on Invoice
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_reservation_id_fkey"
  FOREIGN KEY ("reservation_id") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
