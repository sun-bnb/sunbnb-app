-- Veri*factu authorisations from the obligado (track 026 P7a).
--
-- Two distinct legal acts, kept apart because they gate different things:
--   * invoicing_authority  -- art. 5 RD 1619/2012, lets us EXPEDITE invoices in
--     the partner's name. Already relied on by every partner sale.
--   * aeat_submission      -- colaboracion social, lets us SUBMIT their records.
--     Without it AEAT refuses the whole envio with 4112.
--
-- All nullable and additive: old code ignores them, and a NULL means "not
-- granted", which is the safe reading.
ALTER TABLE "PartnerAccount" ADD COLUMN     "invoicing_authority_granted_at" TIMESTAMP(3),
ADD COLUMN     "aeat_submission_granted_at" TIMESTAMP(3),
ADD COLUMN     "verifactu_grant_terms_version" TEXT,
ADD COLUMN     "verifactu_grant_evidence" JSONB;
