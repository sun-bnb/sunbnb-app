-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "platform_vat_config_id" TEXT;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_platform_vat_config_id_fkey" FOREIGN KEY ("platform_vat_config_id") REFERENCES "PlatformVatConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
