-- AlterTable
ALTER TABLE "device" ADD COLUMN     "light_sleep_per_mille" INTEGER,
ADD COLUMN     "net_fail_at" TIMESTAMP(3),
ADD COLUMN     "reported_ssid" TEXT,
ADD COLUMN     "wifi_drops" INTEGER,
ADD COLUMN     "wifi_joins" INTEGER,
ADD COLUMN     "wifi_retries" INTEGER,
ADD COLUMN     "wifi_sent_at" TIMESTAMP(3),
ADD COLUMN     "wifi_stale_reuses" INTEGER,
ADD COLUMN     "wifi_stale_timeouts" INTEGER;

-- AlterTable
ALTER TABLE "device_telemetry" ADD COLUMN     "light_sleep_per_mille" INTEGER,
ADD COLUMN     "net_fail" BOOLEAN,
ADD COLUMN     "reported_ssid" TEXT,
ADD COLUMN     "wifi_drops" INTEGER,
ADD COLUMN     "wifi_joins" INTEGER,
ADD COLUMN     "wifi_retries" INTEGER,
ADD COLUMN     "wifi_stale_reuses" INTEGER,
ADD COLUMN     "wifi_stale_timeouts" INTEGER;
