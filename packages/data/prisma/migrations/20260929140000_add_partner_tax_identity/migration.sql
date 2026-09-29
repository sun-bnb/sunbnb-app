-- Issuer tax identity (track 026 phase 3).
--
-- ADDITIVE ONLY: three nullable columns and one boolean with a default, so old
-- code that knows none of them keeps working against this schema unchanged.

ALTER TABLE "PartnerAccount" ADD COLUMN     "vat_id_status" TEXT,
ADD COLUMN     "vat_id_checked_at" TIMESTAMP(3),
ADD COLUMN     "tax_region" TEXT,
ADD COLUMN     "is_test_account" BOOLEAN NOT NULL DEFAULT false;
