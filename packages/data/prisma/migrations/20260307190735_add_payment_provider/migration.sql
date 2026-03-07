-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "payment_provider" TEXT NOT NULL DEFAULT 'stripe';
