-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_seat_id_fkey" FOREIGN KEY ("seat_id") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
