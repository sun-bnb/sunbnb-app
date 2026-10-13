-- Track 032 step 2 (CONTRACT): drop the retired admin payout-settlement feature.
-- Safe only after step 1 (e8959fe) is deployed everywhere: no running code reads these.
-- Production had 0 Settlement rows and 0 invoices with settlement_batch_id (2026-10-13).
-- Invoice.settlement_id (the PSP payout id) is a different column and stays.

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_settlement_batch_id_fkey";

-- DropForeignKey
ALTER TABLE "Settlement" DROP CONSTRAINT "Settlement_account_id_fkey";

-- DropForeignKey
ALTER TABLE "Settlement" DROP CONSTRAINT "Settlement_site_id_fkey";

-- AlterTable
ALTER TABLE "Invoice" DROP COLUMN "settlement_batch_id";

-- DropTable
DROP TABLE "Settlement";

-- DropEnum
DROP TYPE "SettlementStatus";

