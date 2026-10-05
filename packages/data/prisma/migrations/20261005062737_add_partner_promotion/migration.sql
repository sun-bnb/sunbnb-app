-- CreateTable
CREATE TABLE "partner_promotion" (
    "id" TEXT NOT NULL,
    "partner_account_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "granted_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_promotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_promotion_partner_account_id_code_key" ON "partner_promotion"("partner_account_id", "code");

-- AddForeignKey
ALTER TABLE "partner_promotion" ADD CONSTRAINT "partner_promotion_partner_account_id_fkey" FOREIGN KEY ("partner_account_id") REFERENCES "PartnerAccount"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

