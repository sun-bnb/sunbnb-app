-- CreateTable
CREATE TABLE "table_waitlist_entry" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "date_iso" TEXT NOT NULL,
    "requested_time" TEXT,
    "party_size" INTEGER NOT NULL,
    "guest_name" TEXT NOT NULL,
    "guest_email" TEXT NOT NULL,
    "guest_phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "notified_at" TIMESTAMP(3),
    "user_id" TEXT,
    "anon_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "table_waitlist_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "table_waitlist_entry_restaurant_id_date_iso_status_idx" ON "table_waitlist_entry"("restaurant_id", "date_iso", "status");

-- AddForeignKey
ALTER TABLE "table_waitlist_entry" ADD CONSTRAINT "table_waitlist_entry_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
