/*
  Warnings:

  - A unique constraint covering the columns `[invoice_id]` on the table `Reservation` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "invoice_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_invoice_id_key" ON "Reservation"("invoice_id");

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
