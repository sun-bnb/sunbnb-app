-- CreateIndex
CREATE INDEX "Invoice_issuer_type_invoiced_at_idx" ON "Invoice"("issuer_type", "invoiced_at");

-- CreateIndex
CREATE INDEX "Invoice_account_id_idx" ON "Invoice"("account_id");
