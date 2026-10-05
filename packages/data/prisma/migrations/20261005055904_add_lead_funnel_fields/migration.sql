-- AlterTable
ALTER TABLE "lead" ADD COLUMN     "angle" TEXT,
ADD COLUMN     "claim_token" TEXT,
ADD COLUMN     "claimed_at" TIMESTAMP(3),
ADD COLUMN     "claimed_by_user_id" TEXT,
ADD COLUMN     "claimed_site_id" TEXT,
ADD COLUMN     "fbclid" TEXT,
ADD COLUMN     "gclid" TEXT,
ADD COLUMN     "marketing_consent_at" TIMESTAMP(3),
ADD COLUMN     "placement_source" TEXT,
ADD COLUMN     "projection" JSONB,
ADD COLUMN     "projection_at" TIMESTAMP(3),
ADD COLUMN     "variant" TEXT;

-- CreateTable
CREATE TABLE "lead_event" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT,
    "name" TEXT NOT NULL,
    "variant" TEXT,
    "angle" TEXT,
    "props" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_event_name_created_at_idx" ON "lead_event"("name", "created_at");

-- CreateIndex
CREATE INDEX "lead_event_lead_id_idx" ON "lead_event"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_claim_token_key" ON "lead"("claim_token");

-- AddForeignKey
ALTER TABLE "lead_event" ADD CONSTRAINT "lead_event_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

