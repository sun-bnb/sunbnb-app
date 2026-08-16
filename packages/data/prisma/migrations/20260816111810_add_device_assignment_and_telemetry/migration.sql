-- AlterTable
ALTER TABLE "device" ADD COLUMN     "assigned_parcel" INTEGER,
ADD COLUMN     "assigned_row" INTEGER,
ADD COLUMN     "assigned_seq" INTEGER,
ADD COLUMN     "assigned_site_id" TEXT,
ADD COLUMN     "partner_account_id" TEXT,
ADD COLUMN     "reported_location" TEXT,
ADD COLUMN     "up_sec" INTEGER;
