-- AlterTable
ALTER TABLE "table_reservation" ADD COLUMN     "booking_group_id" TEXT;

-- CreateTable
CREATE TABLE "table_combination" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "name" TEXT,
    "capacity" INTEGER NOT NULL,
    "table_ids" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "table_combination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "table_combination_restaurant_id_idx" ON "table_combination"("restaurant_id");

-- CreateIndex
CREATE INDEX "table_reservation_booking_group_id_idx" ON "table_reservation"("booking_group_id");

-- AddForeignKey
ALTER TABLE "table_combination" ADD CONSTRAINT "table_combination_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
