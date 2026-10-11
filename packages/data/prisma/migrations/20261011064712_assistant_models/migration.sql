-- CreateTable
CREATE TABLE "assistant_conversation" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "site_id" TEXT,
    "title" TEXT,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "usage" JSONB,
    "consent_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_action" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "snapshot" JSONB,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "result_summary" JSONB,
    "actor_user_id" TEXT NOT NULL,
    "impersonator_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "applied_at" TIMESTAMP(3),
    "undone_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_upload" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "site_id" TEXT,
    "blob_key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "purpose" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_upload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_conversation_account_id_updated_at_idx" ON "assistant_conversation"("account_id", "updated_at");

-- CreateIndex
CREATE INDEX "assistant_action_conversation_id_idx" ON "assistant_action"("conversation_id");

-- CreateIndex
CREATE INDEX "assistant_action_site_id_status_idx" ON "assistant_action"("site_id", "status");

-- CreateIndex
CREATE INDEX "assistant_action_status_expires_at_idx" ON "assistant_action"("status", "expires_at");

-- CreateIndex
CREATE INDEX "assistant_upload_account_id_created_at_idx" ON "assistant_upload"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "assistant_upload_expires_at_idx" ON "assistant_upload"("expires_at");

-- AddForeignKey
ALTER TABLE "assistant_conversation" ADD CONSTRAINT "assistant_conversation_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "PartnerAccount"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_conversation" ADD CONSTRAINT "assistant_conversation_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_action" ADD CONSTRAINT "assistant_action_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "assistant_conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_action" ADD CONSTRAINT "assistant_action_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "PartnerAccount"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_action" ADD CONSTRAINT "assistant_action_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_upload" ADD CONSTRAINT "assistant_upload_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "PartnerAccount"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_upload" ADD CONSTRAINT "assistant_upload_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
