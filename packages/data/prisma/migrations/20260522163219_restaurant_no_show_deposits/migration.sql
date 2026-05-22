-- AlterTable
ALTER TABLE "restaurant" ADD COLUMN     "deposit_per_guest" DOUBLE PRECISION,
ADD COLUMN     "no_show_policy" TEXT NOT NULL DEFAULT 'none';

-- AlterTable
ALTER TABLE "table_reservation" ADD COLUMN     "deposit_amount" DOUBLE PRECISION,
ADD COLUMN     "deposit_status" TEXT,
ADD COLUMN     "payment_ref" TEXT;
