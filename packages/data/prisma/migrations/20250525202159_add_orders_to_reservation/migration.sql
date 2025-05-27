-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "reservation_id" TEXT;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
