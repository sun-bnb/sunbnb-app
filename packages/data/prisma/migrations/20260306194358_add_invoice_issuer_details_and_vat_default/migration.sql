-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "issuer_company_address" TEXT,
ADD COLUMN     "issuer_company_name" TEXT;

-- AlterTable
ALTER TABLE "PlatformVatConfig" ADD COLUMN     "is_default" BOOLEAN NOT NULL DEFAULT false;
