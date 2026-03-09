-- AlterTable
ALTER TABLE "SiteBrand" ADD COLUMN     "accent_color" TEXT,
ADD COLUMN     "custom_domain" TEXT,
ADD COLUMN     "logo_url" TEXT,
ADD COLUMN     "primary_color" TEXT,
ADD COLUMN     "show_map" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "show_prices" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "tagline" TEXT;
