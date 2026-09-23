-- AlterTable
ALTER TABLE "device" ADD COLUMN     "cell_temp_c" INTEGER,
ADD COLUMN     "reported_face" TEXT,
ADD COLUMN     "reported_interval_sec" INTEGER,
ADD COLUMN     "wifi_channel" INTEGER;
