-- AlterTable
ALTER TABLE "_InventoryItemToReservation" ADD CONSTRAINT "_InventoryItemToReservation_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_InventoryItemToReservation_AB_unique";
