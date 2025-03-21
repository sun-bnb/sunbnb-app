/*
  Warnings:

  - A unique constraint covering the columns `[pair_id]` on the table `InventoryItem` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "pair_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_pair_id_key" ON "InventoryItem"("pair_id");

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_pair_id_fkey" FOREIGN KEY ("pair_id") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
