-- DropForeignKey
ALTER TABLE "Reservation" DROP CONSTRAINT "Reservation_item_id_fkey";

-- CreateTable
CREATE TABLE "_InventoryItemToReservation" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_InventoryItemToReservation_AB_unique" ON "_InventoryItemToReservation"("A", "B");

-- CreateIndex
CREATE INDEX "_InventoryItemToReservation_B_index" ON "_InventoryItemToReservation"("B");

-- AddForeignKey
ALTER TABLE "_InventoryItemToReservation" ADD CONSTRAINT "_InventoryItemToReservation_A_fkey" FOREIGN KEY ("A") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_InventoryItemToReservation" ADD CONSTRAINT "_InventoryItemToReservation_B_fkey" FOREIGN KEY ("B") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
