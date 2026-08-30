-- AlterTable
ALTER TABLE "PartnerAccount" ADD COLUMN     "viva_account_id" TEXT,
ADD COLUMN     "viva_connected_at" TIMESTAMP(3),
ADD COLUMN     "viva_merchant_id" TEXT,
ADD COLUMN     "viva_source_code" TEXT,
ADD COLUMN     "viva_verification_status" TEXT;

-- CreateTable
CREATE TABLE "viva_terminal" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "terminal_id" TEXT NOT NULL,
    "label" TEXT,
    "cash_register_id" TEXT NOT NULL,
    "last_seen_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "viva_terminal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "viva_terminal_terminal_id_key" ON "viva_terminal"("terminal_id");

-- CreateIndex
CREATE INDEX "viva_terminal_site_id_idx" ON "viva_terminal"("site_id");

-- AddForeignKey
ALTER TABLE "viva_terminal" ADD CONSTRAINT "viva_terminal_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
