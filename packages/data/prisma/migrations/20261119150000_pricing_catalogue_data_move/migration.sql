-- CR-002 data move: Starter/Pro/Business -> Gratis/Temporada/Grupo (founder decisions M-65, 2026-11-19).
--
-- Class: EXPAND-SAFE DATA MOVE. No DDL. The SubscriptionTier enum keeps its stored labels
-- (STARTER/PRO/BUSINESS); Prisma maps them to GRATIS/TEMPORADA/GRUPO via @map, so code
-- already deployed on the shared TEST DB reads the same values. Idempotent: every statement
-- is a guarded UPDATE or an INSERT ... WHERE NOT EXISTS, and a fresh DB (no plans, no
-- Settings) is a no-op. Mirrors prisma/seed-subscriptions.ts and src/pricing-tiers.ts.
--
-- Stripe: no plan bills a monthly price any more. This migration NULLs the plans' Stripe
-- product/price ids so no new paid subscription can start, and leaves each partner's
-- stripe_subscription_id in place: the live Stripe subscription must be set to cancel at
-- period end (no refund) in Stripe; the customer.subscription.deleted webhook then clears
-- the link and handleSubscriptionCanceled keeps the partner on its current plan.

-- 1. Plan rows (labels are the stored enum values).
UPDATE "SubscriptionPlan" SET "name" = 'Gratis', "monthly_price" = 0, "max_sites" = 1,
  "max_hamacas_per_site" = 100, "monthly_commission_cap_per_site" = NULL,
  "stripe_product_id" = NULL, "stripe_price_id" = NULL, "updatedAt" = NOW()
WHERE "tier" = 'STARTER';

UPDATE "SubscriptionPlan" SET "name" = 'Temporada', "monthly_price" = 0, "max_sites" = 3,
  "max_hamacas_per_site" = 300, "monthly_commission_cap_per_site" = 199,
  "stripe_product_id" = NULL, "stripe_price_id" = NULL, "updatedAt" = NOW()
WHERE "tier" = 'PRO';

-- Grupo: limits per agreement (CustomSubscription); plan-row fallback = legacy Business site limit.
UPDATE "SubscriptionPlan" SET "name" = 'Grupo', "monthly_price" = 0, "max_sites" = 10,
  "max_hamacas_per_site" = NULL, "monthly_commission_cap_per_site" = 199,
  "stripe_product_id" = NULL, "stripe_price_id" = NULL, "updatedAt" = NOW()
WHERE "tier" = 'BUSINESS';

-- 2. Subscriptions (M-65 mapping).
-- STARTER with online sales on (any site type='paid' AND app_sales_enabled) -> Temporada.
UPDATE "Subscription" s SET "plan_id" = pro."id", "updatedAt" = NOW()
FROM "SubscriptionPlan" cur, "SubscriptionPlan" pro
WHERE s."plan_id" = cur."id" AND cur."tier" = 'STARTER' AND pro."tier" = 'PRO'
  AND EXISTS (
    SELECT 1 FROM "Site" site
    WHERE site."user_id" = s."partner_account_id"
      AND site."type" = 'paid' AND site."app_sales_enabled" = true
  );

-- BUSINESS -> Temporada. (PRO already is Temporada through the @map.)
UPDATE "Subscription" s SET "plan_id" = pro."id", "updatedAt" = NOW()
FROM "SubscriptionPlan" cur, "SubscriptionPlan" pro
WHERE s."plan_id" = cur."id" AND cur."tier" = 'BUSINESS' AND pro."tier" = 'PRO';

-- 3. Platform commission rows (settings-level, tier-specific; negotiated site/account rows
--    are never touched). Percent per service code; F&B is 0% on every plan.
WITH rates(tier, service_code, pct) AS (
  VALUES
    ('STARTER'::"SubscriptionTier",  'sunbed-rental',     0::float8),
    ('STARTER'::"SubscriptionTier",  'food-and-beverage', 0::float8),
    ('STARTER'::"SubscriptionTier",  'equipment-rental',  0::float8),
    ('PRO'::"SubscriptionTier",      'sunbed-rental',     2::float8),
    ('PRO'::"SubscriptionTier",      'food-and-beverage', 0::float8),
    ('PRO'::"SubscriptionTier",      'equipment-rental',  2::float8),
    ('BUSINESS'::"SubscriptionTier", 'sunbed-rental',     2::float8),
    ('BUSINESS'::"SubscriptionTier", 'food-and-beverage', 0::float8),
    ('BUSINESS'::"SubscriptionTier", 'equipment-rental',  2::float8)
)
UPDATE "ServiceFee" f SET "charge_type" = 'percentage', "percentage" = r.pct, "fee_amount" = NULL,
  "updatedAt" = NOW()
FROM rates r
WHERE f."site_id" IS NULL AND f."account_id" IS NULL
  AND f."subscription_tier" = r.tier AND f."service_code" = r.service_code
  AND (f."charge_type" <> 'percentage' OR f."percentage" IS DISTINCT FROM r.pct OR f."fee_amount" IS NOT NULL);

WITH rates(tier, service_code, pct) AS (
  VALUES
    ('STARTER'::"SubscriptionTier",  'sunbed-rental',     0::float8),
    ('STARTER'::"SubscriptionTier",  'food-and-beverage', 0::float8),
    ('STARTER'::"SubscriptionTier",  'equipment-rental',  0::float8),
    ('PRO'::"SubscriptionTier",      'sunbed-rental',     2::float8),
    ('PRO'::"SubscriptionTier",      'food-and-beverage', 0::float8),
    ('PRO'::"SubscriptionTier",      'equipment-rental',  2::float8),
    ('BUSINESS'::"SubscriptionTier", 'sunbed-rental',     2::float8),
    ('BUSINESS'::"SubscriptionTier", 'food-and-beverage', 0::float8),
    ('BUSINESS'::"SubscriptionTier", 'equipment-rental',  2::float8)
)
INSERT INTO "ServiceFee" ("id", "settings_id", "subscription_tier", "charge_type", "percentage",
  "service_code", "createdAt", "updatedAt")
SELECT 'cr002_' || md5(st."id" || ':' || r.tier::text || ':' || r.service_code), st."id", r.tier,
  'percentage', r.pct, r.service_code, NOW(), NOW()
FROM "Settings" st CROSS JOIN rates r
WHERE EXISTS (SELECT 1 FROM "SubscriptionPlan" p WHERE p."tier" = r.tier)
  AND NOT EXISTS (
    SELECT 1 FROM "ServiceFee" f
    WHERE f."settings_id" = st."id" AND f."site_id" IS NULL AND f."account_id" IS NULL
      AND f."subscription_tier" = r.tier AND f."service_code" = r.service_code
  );
