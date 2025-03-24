/*
  Warnings:

  - You are about to drop the column `amount` on the `ServiceFee` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `ServiceFee` table. All the data in the column will be lost.
  - Added the required column `charge_type` to the `ServiceFee` table without a default value. This is not possible if the table is not empty.
  - Added the required column `service_code` to the `ServiceFee` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ServiceFee" DROP COLUMN "amount",
DROP COLUMN "type",
ADD COLUMN     "charge_type" TEXT NOT NULL,
ADD COLUMN     "fee_amount" DOUBLE PRECISION,
ADD COLUMN     "percentage" DOUBLE PRECISION,
ADD COLUMN     "service_code" TEXT NOT NULL;
