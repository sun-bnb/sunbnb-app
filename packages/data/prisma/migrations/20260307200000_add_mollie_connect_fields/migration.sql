-- AlterTable
ALTER TABLE "PartnerAccount" ADD COLUMN "mollie_profile_id" TEXT,
ADD COLUMN "mollie_access_token" TEXT,
ADD COLUMN "mollie_refresh_token" TEXT,
ADD COLUMN "mollie_onboarding_status" TEXT;
