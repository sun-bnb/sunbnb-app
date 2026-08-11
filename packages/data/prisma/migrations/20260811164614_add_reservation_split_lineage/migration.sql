-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "split_from_id" TEXT;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_split_from_id_fkey" FOREIGN KEY ("split_from_id") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
