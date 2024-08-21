-- CreateTable
CREATE TABLE "SiteWorkingHours" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "open_time" TIMESTAMP(3) NOT NULL,
    "close_time" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteWorkingHours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteWorkingHours_id_key" ON "SiteWorkingHours"("id");

-- AddForeignKey
ALTER TABLE "SiteWorkingHours" ADD CONSTRAINT "SiteWorkingHours_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
