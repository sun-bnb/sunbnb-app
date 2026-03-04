-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'CLOSED', 'APPROVED', 'PAID');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "settlement_batch_id" TEXT;

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "gross_revenue" DOUBLE PRECISION NOT NULL,
    "total_tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commission" DOUBLE PRECISION NOT NULL,
    "net_payout" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "bank_reference" TEXT,
    "paid_at" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_settlement_batch_id_fkey" FOREIGN KEY ("settlement_batch_id") REFERENCES "Settlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "PartnerAccount"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
