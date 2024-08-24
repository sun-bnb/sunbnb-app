-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "coords" geometry(Point, 4326);

-- CreateIndex
CREATE INDEX "site_coords_idx" ON "Site" USING GIST ("coords");
