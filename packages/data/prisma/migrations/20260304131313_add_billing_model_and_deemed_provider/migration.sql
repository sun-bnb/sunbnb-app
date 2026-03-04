-- CreateEnum
CREATE TYPE "BillingModel" AS ENUM ('INTERMEDIARY', 'DEEMED_PROVIDER');

-- CreateEnum
CREATE TYPE "InvoiceIssuerType" AS ENUM ('PARTNER', 'PLATFORM');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "issuer_type" "InvoiceIssuerType" NOT NULL DEFAULT 'PARTNER',
ADD COLUMN     "issuer_vat_number" TEXT,
ADD COLUMN     "settlement_id" TEXT;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "billing_model" "BillingModel" NOT NULL DEFAULT 'INTERMEDIARY';

-- CreateTable
CREATE TABLE "PlatformVatConfig" (
    "id" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "vat_number" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "company_address" TEXT NOT NULL,
    "oss_registered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformVatConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformVatConfig_country_code_key" ON "PlatformVatConfig"("country_code");
