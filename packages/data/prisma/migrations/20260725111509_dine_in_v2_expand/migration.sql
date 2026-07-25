-- Dine-in tabs v2 — expand migration (additive; see .claude/rules/migrations.md).
-- Decouples dine-in ordering from Site: Order/TableTab gain a restaurant anchor
-- (siteId becomes nullable; linked venues dual-write both), MenuItem gains the
-- VAT triple, Restaurant gains the dine-in master switch.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "restaurant_id" TEXT,
ALTER COLUMN "site_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "menu_item" ADD COLUMN     "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "total_price" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill: pre-v2 menu items are treated as gross with 0% VAT (price = totalPrice).
UPDATE "menu_item" SET "total_price" = "price" WHERE "total_price" = 0;

-- AlterTable
ALTER TABLE "restaurant" ADD COLUMN "dine_in_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: carry over live linked venues so the gate cutover (site.appSalesEnabled
-- → restaurant.dineInEnabled) is seamless for venues already taking dine-in orders.
UPDATE "restaurant" r
SET "dine_in_enabled" = true
FROM "Site" s
WHERE r."site_id" = s."id" AND s."app_sales_enabled" = true;

-- AlterTable
ALTER TABLE "table_tab" ALTER COLUMN "site_id" DROP NOT NULL;

-- Backfill: existing tab orders inherit the restaurant anchor from their tab
-- (table_tab.restaurant_id has been populated since P1.5 v1).
UPDATE "Order" o
SET "restaurant_id" = tt."restaurant_id"
FROM "table_tab" tt
WHERE o."tab_id" = tt."id" AND o."restaurant_id" IS NULL;

-- CreateIndex
CREATE INDEX "Order_restaurant_id_idx" ON "Order"("restaurant_id");

-- CreateIndex
CREATE INDEX "table_tab_restaurant_id_idx" ON "table_tab"("restaurant_id");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_tab" ADD CONSTRAINT "table_tab_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ownership anchor: every Order belongs to a site, a restaurant, or (linked-venue
-- dual-write) both — never neither. At-least-one, NOT XOR, by design. Raw SQL
-- because Prisma cannot model CHECK constraints (precedent: layout_element_owner_chk).
ALTER TABLE "Order" ADD CONSTRAINT "order_owner_chk"
CHECK ("site_id" IS NOT NULL OR "restaurant_id" IS NOT NULL);
