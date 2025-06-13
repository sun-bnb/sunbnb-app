-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "item_group_id" TEXT;

-- CreateTable
CREATE TABLE "ItemGroup" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "label" TEXT,
    "rows" INTEGER NOT NULL,
    "seats_per_row" INTEGER NOT NULL,
    "location_lat" TEXT NOT NULL,
    "location_lng" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "rotation" INTEGER NOT NULL DEFAULT 0,
    "horizontal_gap" INTEGER NOT NULL,
    "vertical_gap" INTEGER NOT NULL,
    "pair_gap" INTEGER NOT NULL,
    "category" TEXT,
    "price" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ItemGroup_id_key" ON "ItemGroup"("id");

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_item_group_id_fkey" FOREIGN KEY ("item_group_id") REFERENCES "ItemGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
