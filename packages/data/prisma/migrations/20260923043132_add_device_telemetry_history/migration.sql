-- CreateTable
CREATE TABLE "device_telemetry" (
    "id" BIGSERIAL NOT NULL,
    "device_id" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fw" TEXT,
    "batt_mv" INTEGER,
    "vmin_mv" INTEGER,
    "rssi_dbm" INTEGER,
    "up_sec" INTEGER,
    "temp_c" INTEGER,
    "cell_temp_c" INTEGER,
    "current_ua" INTEGER,
    "imax_ua" INTEGER,
    "charge_uah" INTEGER,
    "full_count" INTEGER,
    "heap_free_bytes" INTEGER,
    "poll_fails" INTEGER,
    "wifi_channel" INTEGER,
    "reported_interval_sec" INTEGER,
    "reported_power_mode" TEXT,
    "reset_reason" TEXT,
    "reported_face" TEXT,
    "reported_location" TEXT,

    CONSTRAINT "device_telemetry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_telemetry_device_id_recorded_at_idx" ON "device_telemetry"("device_id", "recorded_at");

-- CreateIndex
CREATE INDEX "device_telemetry_recorded_at_idx" ON "device_telemetry"("recorded_at");

-- AddForeignKey
ALTER TABLE "device_telemetry" ADD CONSTRAINT "device_telemetry_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
