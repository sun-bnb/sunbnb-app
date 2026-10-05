
-- CreateTable
CREATE TABLE "coast_tile" (
    "key" TEXT NOT NULL,
    "ways" INTEGER NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coast_tile_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "coast_line" (
    "osm_way_id" BIGINT NOT NULL,
    "geom" geometry NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coast_line_pkey" PRIMARY KEY ("osm_way_id")
);

-- CreateIndex
CREATE INDEX "coast_line_geom_idx" ON "coast_line" USING GIST ("geom");

