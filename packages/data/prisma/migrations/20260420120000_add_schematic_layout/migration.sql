-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "schematic_x" DOUBLE PRECISION,
ADD COLUMN     "schematic_y" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ItemGroup" ADD COLUMN     "schematic_x" DOUBLE PRECISION,
ADD COLUMN     "schematic_y" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "layout_height" DOUBLE PRECISION,
ADD COLUMN     "layout_mode" TEXT NOT NULL DEFAULT 'geo',
ADD COLUMN     "layout_width" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "layout_element" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "shape" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "z" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "layout_element_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "layout_element_site_id_idx" ON "layout_element"("site_id");

-- AddForeignKey
ALTER TABLE "layout_element" ADD CONSTRAINT "layout_element_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
