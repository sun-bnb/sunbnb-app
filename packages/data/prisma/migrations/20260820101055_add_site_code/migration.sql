-- Track 022: a stable EXTERNAL identifier for a site.
--
-- The site half of the printed QR URL (`/q/S-K7M2X9/1-1-1`). `Site.id` is a
-- 25-char cuid, which was half of an 80-character URL and therefore half of the
-- card's QR-density problem. Not `slug`: that one is partner-editable (a rename
-- would silently kill every card already glued to a lounger), variable-length,
-- and unconstrained here.
--
-- Nullable during expand and backfilled (`backfill:site-codes:*`); the unique
-- index is safe to add now because NULLs do not conflict with each other in
-- Postgres.
ALTER TABLE "Site" ADD COLUMN "code" TEXT;
CREATE UNIQUE INDEX "Site_code_key" ON "Site"("code");
