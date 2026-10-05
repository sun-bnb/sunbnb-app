-- AlterTable
ALTER TABLE "coast_tile" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'overpass';

-- CreateTable
CREATE TABLE "coast_water" (
    "id" BIGINT NOT NULL,
    "geom" geometry NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coast_water_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coast_water_geom_idx" ON "coast_water" USING GIST ("geom");

