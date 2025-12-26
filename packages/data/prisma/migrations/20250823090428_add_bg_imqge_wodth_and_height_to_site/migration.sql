/*
  Warnings:

  - You are about to drop the column `bg_url` on the `Site` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Site" DROP COLUMN "bg_url",
ADD COLUMN     "bg_image_height" INTEGER,
ADD COLUMN     "bg_image_url" TEXT,
ADD COLUMN     "bg_image_width" INTEGER;
