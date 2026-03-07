-- DropForeignKey
ALTER TABLE "Site" DROP CONSTRAINT "Site_platform_vat_config_id_fkey";

-- AlterTable
ALTER TABLE "Invoice" DROP COLUMN "issuer_type",
ADD COLUMN     "issuer_type" TEXT NOT NULL DEFAULT 'PARTNER';

-- AlterTable
ALTER TABLE "Site" DROP COLUMN "billing_model",
DROP COLUMN "platform_vat_config_id";

-- DropTable
DROP TABLE "PlatformVatConfig";

-- DropEnum
DROP TYPE "BillingModel";

-- DropEnum
DROP TYPE "InvoiceIssuerType";
