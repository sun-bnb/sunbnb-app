-- AlterTable
ALTER TABLE "CustomSubscription" ADD COLUMN     "max_hamacas_per_site" INTEGER;

-- AlterTable
ALTER TABLE "SubscriptionPlan" ADD COLUMN     "max_hamacas_per_site" INTEGER,
ADD COLUMN     "monthly_commission_cap_per_site" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "commission_cap_entry" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "uncapped_amount" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_cap_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commission_cap_entry_source_key_key" ON "commission_cap_entry"("source_key");

-- CreateIndex
CREATE INDEX "commission_cap_entry_site_id_month_idx" ON "commission_cap_entry"("site_id", "month");

-- AddForeignKey
ALTER TABLE "commission_cap_entry" ADD CONSTRAINT "commission_cap_entry_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

