-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "slug" TEXT;

-- CreateTable
CREATE TABLE "SiteBrand" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "bg_image_url" TEXT,
    "bg_image_width" INTEGER,
    "bg_image_height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteBrand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteBrand_id_key" ON "SiteBrand"("id");

-- CreateIndex
CREATE UNIQUE INDEX "SiteBrand_site_id_key" ON "SiteBrand"("site_id");

-- AddForeignKey
ALTER TABLE "SiteBrand" ADD CONSTRAINT "SiteBrand_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
