-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "item_id" TEXT,
    "open_time" TIMESTAMP(3) NOT NULL,
    "close_time" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_id_key" ON "Reservation"("id");

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
