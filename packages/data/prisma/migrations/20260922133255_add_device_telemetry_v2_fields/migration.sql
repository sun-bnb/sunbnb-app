-- AlterTable
ALTER TABLE "device" ADD COLUMN     "charge_uah" INTEGER,
ADD COLUMN     "current_ua" INTEGER,
ADD COLUMN     "heap_free_bytes" INTEGER,
ADD COLUMN     "poll_fails" INTEGER,
ADD COLUMN     "reported_power_mode" TEXT,
ADD COLUMN     "reset_reason" TEXT,
ADD COLUMN     "temp_c" INTEGER;
