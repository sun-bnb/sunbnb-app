-- AlterTable
ALTER TABLE "device" ADD COLUMN     "pending_cmd" TEXT,
ADD COLUMN     "pending_cmd_at" TIMESTAMP(3);
