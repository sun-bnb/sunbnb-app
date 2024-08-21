/*
  Warnings:

  - A unique constraint covering the columns `[id]` on the table `Site` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Site_id_key" ON "Site"("id");
