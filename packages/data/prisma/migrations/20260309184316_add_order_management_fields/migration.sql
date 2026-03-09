-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "accepted_at" TIMESTAMP(3),
ADD COLUMN     "delivered_at" TIMESTAMP(3),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "ready_at" TIMESTAMP(3),
ADD COLUMN     "reject_reason" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "category" TEXT,
ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "category" TEXT DEFAULT 'food',
ADD COLUMN     "prep_time" INTEGER,
ADD COLUMN     "sold_out" BOOLEAN NOT NULL DEFAULT false;
