-- Per-issuer invoice numbering and hash chaining (track 026).
--
-- ADDITIVE ONLY. Every new column is nullable, both new tables are new, and the
-- two unique indexes cover columns that are NULL on every existing row — and
-- NULLs do not collide in Postgres. Old code, which knows none of these, keeps
-- working unchanged against this schema.

-- AlterTable: the series coordinates and the hash version a row was written under
ALTER TABLE "Invoice" ADD COLUMN     "series_key" TEXT,
ADD COLUMN     "series_code" TEXT,
ADD COLUMN     "series_year" INTEGER,
ADD COLUMN     "series_seq" INTEGER,
ADD COLUMN     "hash_version" TEXT;

-- AlterTable: the human-readable stem of a partner's invoice numbers
ALTER TABLE "PartnerAccount" ADD COLUMN     "invoice_series_prefix" TEXT;

-- CreateTable: the number counter, one row per (issuer, series, year)
CREATE TABLE "invoice_series" (
    "id" TEXT NOT NULL,
    "series_key" TEXT NOT NULL,
    "series_code" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable: the head of one issuer's hash chain
CREATE TABLE "invoice_chain" (
    "series_key" TEXT NOT NULL,
    "last_hash" TEXT,
    "last_seq_no" INTEGER NOT NULL DEFAULT 0,
    "last_invoice_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_chain_pkey" PRIMARY KEY ("series_key")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_series_series_key_series_code_year_key" ON "invoice_series"("series_key", "series_code", "year");

-- CreateIndex
CREATE INDEX "Invoice_series_key_series_seq_idx" ON "Invoice"("series_key", "series_seq");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_series_key_series_code_series_year_series_seq_key" ON "Invoice"("series_key", "series_code", "series_year", "series_seq");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerAccount_invoice_series_prefix_key" ON "PartnerAccount"("invoice_series_prefix");
