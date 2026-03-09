-- AlterTable
ALTER TABLE "SiteBrand" DROP COLUMN IF EXISTS "custom_domain",
DROP COLUMN IF EXISTS "show_map",
DROP COLUMN IF EXISTS "show_prices";

-- AlterTable
ALTER TABLE "SiteBrand" ADD COLUMN "bg_color" TEXT,
ADD COLUMN "fg_color" TEXT;
