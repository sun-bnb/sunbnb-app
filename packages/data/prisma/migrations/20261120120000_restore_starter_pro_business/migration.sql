-- Back to the Starter / Pro / Business ladder (founder decision 2026-11-20), replacing the
-- CR-002 Gratis / Temporada / Grupo values written by 20261119150000_pricing_catalogue_data_move.
--
--   Starter   EUR 0          6% commission    1 site
--   Pro       EUR 29 / month 3% commission    3 sites
--   Business  EUR 79 / month 1.5% commission  10 sites
--
-- The same rate on every commissioned service code (sunbeds, food and drink, rentals). No
-- hamaca limit and no monthly commission cap on any plan (columns NULL; the CR-002 machinery
-- stays, inert). Mirrors src/pricing-tiers.ts and prisma/seed-subscriptions.ts.
--
-- Class: EXPAND-SAFE DATA MOVE. No DDL; the enum labels were always STARTER/PRO/BUSINESS.
-- Idempotent (guarded UPDATEs, INSERT ... WHERE NOT EXISTS); a fresh DB is a no-op.
--
-- NOT done here:
--   * Stripe product / price ids stay as they are (NULL since the CR-002 move). They are per
--     environment; set them on the PRO and BUSINESS rows out of band before anyone can subscribe.
--   * Partner subscriptions are not moved. A partner on PRO / BUSINESS without a Stripe
--     subscription keeps that plan (complimentary) until an admin changes it.
--   * Negotiated site- / account-level ServiceFee rows are untouched.

-- 1. Plan rows.
UPDATE "SubscriptionPlan" SET "name" = 'Starter', "monthly_price" = 0, "max_sites" = 1,
  "max_hamacas_per_site" = NULL, "monthly_commission_cap_per_site" = NULL, "updatedAt" = NOW()
WHERE "tier" = 'STARTER'
  AND ("name" <> 'Starter' OR "monthly_price" <> 0 OR "max_sites" <> 1
       OR "max_hamacas_per_site" IS NOT NULL OR "monthly_commission_cap_per_site" IS NOT NULL);

UPDATE "SubscriptionPlan" SET "name" = 'Pro', "monthly_price" = 29, "max_sites" = 3,
  "max_hamacas_per_site" = NULL, "monthly_commission_cap_per_site" = NULL, "updatedAt" = NOW()
WHERE "tier" = 'PRO'
  AND ("name" <> 'Pro' OR "monthly_price" <> 29 OR "max_sites" <> 3
       OR "max_hamacas_per_site" IS NOT NULL OR "monthly_commission_cap_per_site" IS NOT NULL);

UPDATE "SubscriptionPlan" SET "name" = 'Business', "monthly_price" = 79, "max_sites" = 10,
  "max_hamacas_per_site" = NULL, "monthly_commission_cap_per_site" = NULL, "updatedAt" = NOW()
WHERE "tier" = 'BUSINESS'
  AND ("name" <> 'Business' OR "monthly_price" <> 79 OR "max_sites" <> 10
       OR "max_hamacas_per_site" IS NOT NULL OR "monthly_commission_cap_per_site" IS NOT NULL);

-- 2. Platform commission rows (settings-level, tier-specific).
WITH rates(tier, service_code, pct) AS (
  VALUES
    ('STARTER'::"SubscriptionTier",  'sunbed-rental',     6::float8),
    ('STARTER'::"SubscriptionTier",  'food-and-beverage', 6::float8),
    ('STARTER'::"SubscriptionTier",  'equipment-rental',  6::float8),
    ('PRO'::"SubscriptionTier",      'sunbed-rental',     3::float8),
    ('PRO'::"SubscriptionTier",      'food-and-beverage', 3::float8),
    ('PRO'::"SubscriptionTier",      'equipment-rental',  3::float8),
    ('BUSINESS'::"SubscriptionTier", 'sunbed-rental',     1.5::float8),
    ('BUSINESS'::"SubscriptionTier", 'food-and-beverage', 1.5::float8),
    ('BUSINESS'::"SubscriptionTier", 'equipment-rental',  1.5::float8)
)
UPDATE "ServiceFee" f SET "charge_type" = 'percentage', "percentage" = r.pct, "fee_amount" = NULL,
  "updatedAt" = NOW()
FROM rates r
WHERE f."site_id" IS NULL AND f."account_id" IS NULL
  AND f."subscription_tier" = r.tier AND f."service_code" = r.service_code
  AND (f."charge_type" <> 'percentage' OR f."percentage" IS DISTINCT FROM r.pct OR f."fee_amount" IS NOT NULL);

WITH rates(tier, service_code, pct) AS (
  VALUES
    ('STARTER'::"SubscriptionTier",  'sunbed-rental',     6::float8),
    ('STARTER'::"SubscriptionTier",  'food-and-beverage', 6::float8),
    ('STARTER'::"SubscriptionTier",  'equipment-rental',  6::float8),
    ('PRO'::"SubscriptionTier",      'sunbed-rental',     3::float8),
    ('PRO'::"SubscriptionTier",      'food-and-beverage', 3::float8),
    ('PRO'::"SubscriptionTier",      'equipment-rental',  3::float8),
    ('BUSINESS'::"SubscriptionTier", 'sunbed-rental',     1.5::float8),
    ('BUSINESS'::"SubscriptionTier", 'food-and-beverage', 1.5::float8),
    ('BUSINESS'::"SubscriptionTier", 'equipment-rental',  1.5::float8)
)
INSERT INTO "ServiceFee" ("id", "settings_id", "subscription_tier", "charge_type", "percentage",
  "service_code", "createdAt", "updatedAt")
SELECT 'spb_' || md5(st."id" || ':' || r.tier::text || ':' || r.service_code), st."id", r.tier,
  'percentage', r.pct, r.service_code, NOW(), NOW()
FROM "Settings" st CROSS JOIN rates r
WHERE EXISTS (SELECT 1 FROM "SubscriptionPlan" p WHERE p."tier" = r.tier)
  AND NOT EXISTS (
    SELECT 1 FROM "ServiceFee" f
    WHERE f."settings_id" = st."id" AND f."site_id" IS NULL AND f."account_id" IS NULL
      AND f."subscription_tier" = r.tier AND f."service_code" = r.service_code
  );
