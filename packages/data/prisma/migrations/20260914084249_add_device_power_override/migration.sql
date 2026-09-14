-- AlterTable
ALTER TABLE "device" ADD COLUMN     "poll_interval_sec" INTEGER,
ADD COLUMN     "power_mode" TEXT;

-- The per-device power policy is a PAIR: a device either inherits the platform
-- preference entirely or overrides both halves. Hand-written rather than
-- generated, because Prisma cannot model CHECK constraints (precedent:
-- layout_element_owner_chk, 20260421132654_restaurant_add_tables_feature).
--
-- It constrains the PAIRING only, never the values. The mode strings and the
-- poll bands are code-owned policy that has already moved once (light sleep's
-- ceiling, track 025); a CHECK on those would turn a band change into a
-- contract migration and could reject writes from code that is legal.
--
-- The reader does NOT rely on this: resolveDevicePolicyForDevice treats a
-- half-set pair as "inherit" anyway, because a restore, an older release or a
-- direct SQL edit can present anything and the consumer is potted on a beach.
ALTER TABLE "device" ADD CONSTRAINT "device_power_policy_pair_chk"
CHECK (("power_mode" IS NULL) = ("poll_interval_sec" IS NULL));
