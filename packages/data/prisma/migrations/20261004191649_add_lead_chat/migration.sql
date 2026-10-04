-- AlterTable
ALTER TABLE "lead" ADD COLUMN     "business_type" TEXT,
ADD COLUMN     "chat_sessions" JSONB,
ADD COLUMN     "chat_turns" INTEGER NOT NULL DEFAULT 0;
