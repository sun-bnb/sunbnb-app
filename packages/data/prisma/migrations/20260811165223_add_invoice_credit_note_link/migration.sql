-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "credits_invoice_id" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_credits_invoice_id_idx" ON "Invoice"("credits_invoice_id");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_credits_invoice_id_fkey" FOREIGN KEY ("credits_invoice_id") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
