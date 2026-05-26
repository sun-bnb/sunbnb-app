-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "processing_fee" DOUBLE PRECISION,
ADD COLUMN     "recipient_company_address" TEXT,
ADD COLUMN     "recipient_company_name" TEXT,
ADD COLUMN     "recipient_vat_number" TEXT,
ADD COLUMN     "reverse_charge" BOOLEAN NOT NULL DEFAULT false;
