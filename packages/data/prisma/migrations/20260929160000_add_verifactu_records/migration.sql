-- Veri*factu billing records (track 026 phase 5).
--
-- ADDITIVE ONLY: one nullable column on Invoice and two new tables. Old code,
-- which knows none of it, keeps working against this schema unchanged.

-- AlterTable: the document type, decided at issuance and then fixed
ALTER TABLE "Invoice" ADD COLUMN     "tipo_factura" TEXT;

-- CreateTable: what is filed with AEAT about an invoice
CREATE TABLE "verifactu_record" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "record_type" TEXT NOT NULL,
    "issuer_nif" TEXT NOT NULL,
    "num_serie_factura" TEXT NOT NULL,
    "fecha_expedicion" TEXT NOT NULL,
    "tipo_factura" TEXT NOT NULL,
    "tipo_rectificativa" TEXT,
    "huella" TEXT NOT NULL,
    "huella_previous" TEXT,
    "huella_input" TEXT NOT NULL,
    "chain_seq" INTEGER NOT NULL,
    "fecha_hora_huso_gen_registro" TEXT NOT NULL,
    "desglose" JSONB NOT NULL,
    "sistema_informatico" JSONB,
    "payload_xml" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "last_attempt_at" TIMESTAMP(3),
    "next_attempt_at" TIMESTAMP(3),
    "csv" TEXT,
    "aeat_response_xml" TEXT,
    "submitted_at" TIMESTAMP(3),
    "spec_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verifactu_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable: the head of one issuer's record chain
CREATE TABLE "verifactu_chain" (
    "issuer_nif" TEXT NOT NULL,
    "last_huella" TEXT,
    "last_chain_seq" INTEGER NOT NULL DEFAULT 0,
    "last_record_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verifactu_chain_pkey" PRIMARY KEY ("issuer_nif")
);

-- CreateIndex
CREATE UNIQUE INDEX "verifactu_record_issuer_nif_chain_seq_key" ON "verifactu_record"("issuer_nif", "chain_seq");

-- CreateIndex
CREATE UNIQUE INDEX "verifactu_record_invoice_id_record_type_key" ON "verifactu_record"("invoice_id", "record_type");

-- CreateIndex
CREATE INDEX "verifactu_record_status_next_attempt_at_idx" ON "verifactu_record"("status", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "verifactu_record" ADD CONSTRAINT "verifactu_record_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
