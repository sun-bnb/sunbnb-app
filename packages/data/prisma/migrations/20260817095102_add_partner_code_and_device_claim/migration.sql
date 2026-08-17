-- Track 021: a stable EXTERNAL identifier for a customer.
--
-- Devices are flashed with this rather than with `user_id`, so an account
-- restructure is a repoint here instead of collecting and reflashing every
-- potted unit. Nullable during expand and backfilled; the unique index is safe
-- to add now because NULLs do not conflict with each other in Postgres.
ALTER TABLE "PartnerAccount" ADD COLUMN "code" TEXT;
CREATE UNIQUE INDEX "PartnerAccount_code_key" ON "PartnerAccount"("code");

-- What a DEVICE claims its customer is, when that disagrees with its row.
-- Recorded, never acted on — see the schema comment.
ALTER TABLE "device" ADD COLUMN "claimed_partner_code" TEXT;
