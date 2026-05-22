-- CreateTable
CREATE TABLE "restaurant_shift" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "pacing_covers" INTEGER,
    "pacing_window_minutes" INTEGER NOT NULL DEFAULT 15,
    "last_seating_offset_minutes" INTEGER,
    "requires_deposit" BOOLEAN NOT NULL DEFAULT false,
    "deposit_min_party_size" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurant_shift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "restaurant_shift_restaurant_id_day_idx" ON "restaurant_shift"("restaurant_id", "day");

-- AddForeignKey
ALTER TABLE "restaurant_shift" ADD CONSTRAINT "restaurant_shift_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
