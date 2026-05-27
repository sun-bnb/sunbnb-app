-- AlterTable
ALTER TABLE "restaurant" ADD COLUMN     "guest_selection_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "restaurant_table" ADD COLUMN     "guest_selectable" BOOLEAN NOT NULL DEFAULT false;
