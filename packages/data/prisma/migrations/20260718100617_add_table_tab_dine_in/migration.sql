-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "table_tab_id" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "tab_id" TEXT,
ADD COLUMN     "table_id" TEXT;

-- CreateTable
CREATE TABLE "table_tab" (
    "id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "open_table_id" TEXT,
    "anon_id" TEXT,
    "user_id" TEXT,
    "payment_ref" TEXT,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "table_tab_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "table_tab_open_table_id_key" ON "table_tab"("open_table_id");

-- CreateIndex
CREATE INDEX "table_tab_table_id_idx" ON "table_tab"("table_id");

-- CreateIndex
CREATE INDEX "table_tab_site_id_idx" ON "table_tab"("site_id");

-- CreateIndex
CREATE INDEX "table_tab_payment_ref_idx" ON "table_tab"("payment_ref");

-- CreateIndex
CREATE INDEX "Invoice_table_tab_id_idx" ON "Invoice"("table_tab_id");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tab_id_fkey" FOREIGN KEY ("tab_id") REFERENCES "table_tab"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_table_tab_id_fkey" FOREIGN KEY ("table_tab_id") REFERENCES "table_tab"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_tab" ADD CONSTRAINT "table_tab_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "restaurant_table"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_tab" ADD CONSTRAINT "table_tab_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
