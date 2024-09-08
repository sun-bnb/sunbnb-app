/*
  Warnings:

  - You are about to drop the column `close_time` on the `Reservation` table. All the data in the column will be lost.
  - You are about to drop the column `open_time` on the `Reservation` table. All the data in the column will be lost.
  - Added the required column `from` to the `Reservation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `to` to the `Reservation` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Reservation" DROP COLUMN "close_time",
DROP COLUMN "open_time",
ADD COLUMN     "from" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "to" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "services" TEXT[] DEFAULT ARRAY[]::TEXT[];
