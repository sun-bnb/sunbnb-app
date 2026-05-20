-- CreateTable
CREATE TABLE "CustomSubscription" (
    "id" TEXT NOT NULL,
    "partner_account_id" TEXT NOT NULL,
    "max_sites" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomSubscription_partner_account_id_key" ON "CustomSubscription"("partner_account_id");

-- AddForeignKey
ALTER TABLE "CustomSubscription" ADD CONSTRAINT "CustomSubscription_partner_account_id_fkey" FOREIGN KEY ("partner_account_id") REFERENCES "PartnerAccount"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
