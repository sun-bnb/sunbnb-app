-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "sunbed_group_id" TEXT;

-- CreateTable
CREATE TABLE "SunbedGroup" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SunbedGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SunbedGroup_id_key" ON "SunbedGroup"("id");

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_sunbed_group_id_fkey" FOREIGN KEY ("sunbed_group_id") REFERENCES "SunbedGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SunbedGroup" ADD CONSTRAINT "SunbedGroup_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one SunbedGroup per existing pair, idempotent (ON CONFLICT DO NOTHING).
-- Group id is deterministic: 'grp_' || LEAST(item_a_id, item_b_id) — no extension needed,
-- naturally idempotent, and correlates each newly-inserted row back to both pair members.
INSERT INTO "SunbedGroup" (id, site_id, "createdAt", "updatedAt")
SELECT
  'grp_' || LEAST(i.id, i.pair_id),
  i.site_id,
  NOW(),
  NOW()
FROM "InventoryItem" i
WHERE i.pair_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

UPDATE "InventoryItem" i
SET sunbed_group_id = 'grp_' || LEAST(i.id, i.pair_id)
WHERE i.pair_id IS NOT NULL
  AND i.sunbed_group_id IS NULL;
