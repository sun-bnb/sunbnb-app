-- CreateTable
CREATE TABLE "device" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "mac_addr" TEXT,
    "status" TEXT NOT NULL DEFAULT 'provisioned',
    "fw" TEXT,
    "last_seen_at" TIMESTAMP(3),
    "batt_mv" INTEGER,
    "rssi_dbm" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_seat" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "device_seat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_code_key" ON "device"("code");

-- CreateIndex
CREATE UNIQUE INDEX "device_seat_item_id_key" ON "device_seat"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_seat_device_id_position_key" ON "device_seat"("device_id", "position");

-- AddForeignKey
ALTER TABLE "device_seat" ADD CONSTRAINT "device_seat_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_seat" ADD CONSTRAINT "device_seat_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
