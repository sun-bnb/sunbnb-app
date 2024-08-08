-- CreateTable
CREATE TABLE "PartnerAccount" (
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "website_url" TEXT,
    "address" TEXT NOT NULL,
    "bank_account" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "PartnerAccount_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerAccount_user_id_key" ON "PartnerAccount"("user_id");

-- AddForeignKey
ALTER TABLE "PartnerAccount" ADD CONSTRAINT "PartnerAccount_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
