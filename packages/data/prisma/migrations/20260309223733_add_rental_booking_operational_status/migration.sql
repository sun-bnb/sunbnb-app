-- AlterTable
ALTER TABLE "RentalBooking" ADD COLUMN     "guest_name" TEXT,
ADD COLUMN     "operational_status" TEXT NOT NULL DEFAULT 'reserved',
ADD COLUMN     "picked_up_at" TIMESTAMP(3),
ADD COLUMN     "returned_at" TIMESTAMP(3);
