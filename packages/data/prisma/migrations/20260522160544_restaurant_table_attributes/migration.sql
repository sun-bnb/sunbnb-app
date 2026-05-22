-- AlterTable
ALTER TABLE "restaurant_table" ADD COLUMN     "combinable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "features" TEXT[] DEFAULT ARRAY[]::TEXT[];
