-- CreateIndex
CREATE INDEX "InventoryItem_site_id_group_idx" ON "InventoryItem"("site_id", "group");

-- CreateIndex
CREATE INDEX "InventoryItem_site_id_number_idx" ON "InventoryItem"("site_id", "number");

-- CreateIndex
CREATE INDEX "Reservation_site_id_from_to_idx" ON "Reservation"("site_id", "from", "to");
