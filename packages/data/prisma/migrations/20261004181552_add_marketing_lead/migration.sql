-- CreateTable
CREATE TABLE "lead" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'mockup',
    "place_id" TEXT NOT NULL,
    "beach_name" TEXT NOT NULL,
    "beach_address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "sunbed_count" INTEGER NOT NULL,
    "layout_anchor_lat" DOUBLE PRECISION,
    "layout_anchor_lng" DOUBLE PRECISION,
    "layout_sea_bearing" INTEGER,
    "layout_placement" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_term" TEXT,
    "utm_content" TEXT,
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "business_name" TEXT,
    "message" TEXT,
    "consent_at" TIMESTAMP(3),
    "consent_version" TEXT,
    "demo_requested_at" TIMESTAMP(3),
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_token_key" ON "lead"("token");

-- CreateIndex
CREATE INDEX "lead_status_created_at_idx" ON "lead"("status", "created_at");

-- CreateIndex
CREATE INDEX "lead_last_activity_at_idx" ON "lead"("last_activity_at");
