-- Dine-in v2: one-time copy of each linked venue's active site Products into
-- the restaurant MenuItem catalog, which becomes THE orderable dine-in menu
-- (founder decision; Product remains for sunbed/POS F&B only).
--
-- Idempotent per the seed rule in .claude/rules/migrations.md: dedup is
-- per item NAME (NOT EXISTS), so partially hand-entered menus are completed
-- without duplicating same-named items, and a replay inserts nothing.
--
-- displayOrder continues after the restaurant's current max so copied items
-- append below hand-entered ones. Product categories (food/drink) are kept
-- so linked-venue kitchen grouping stays familiar.

INSERT INTO "menu_item"
  (id, restaurant_id, name, description, price, tax, total_price,
   image_url, category, sold_out, active, display_order, "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  r.id,
  p.name,
  p.description,
  p.price,
  p.tax,
  p."totalPrice",
  p.image_url,
  COALESCE(p.category, 'food'),
  p.sold_out,
  true,
  (SELECT COALESCE(MAX(m2.display_order), -1) FROM "menu_item" m2 WHERE m2.restaurant_id = r.id)
    + ROW_NUMBER() OVER (PARTITION BY r.id ORDER BY p.name),
  now(),
  now()
FROM "restaurant" r
JOIN "Product" p ON p.site_id = r.site_id AND p.active = true
WHERE r.site_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "menu_item" m
    WHERE m.restaurant_id = r.id AND m.name = p.name
  );
