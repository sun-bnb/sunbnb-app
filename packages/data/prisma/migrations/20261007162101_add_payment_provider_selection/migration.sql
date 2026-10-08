-- AlterTable
ALTER TABLE "PartnerAccount" ADD COLUMN     "payment_provider" TEXT,
ADD COLUMN     "stripe_connect_account_id" TEXT,
ADD COLUMN     "stripe_connect_charges_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripe_connect_connected_at" TIMESTAMP(3),
ADD COLUMN     "stripe_connect_details_submitted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripe_connect_onboarding_status" TEXT,
ADD COLUMN     "stripe_connect_payouts_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripe_connect_requirements_due" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "stripe_connect_tos_accepted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "stripe_terminal_location_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PartnerAccount_stripe_connect_account_id_key" ON "PartnerAccount"("stripe_connect_account_id");

