-- Adds the restaurant / table-reservation feature. All additions are nullable
-- or defaulted, so existing rows and code paths are unaffected.

-- AlterTable: product discriminator on shared platform tables.
-- Values are domain-categorical (brand-neutral): "beachclub" or "restaurant".
ALTER TABLE "Invoice" ADD COLUMN "product" TEXT NOT NULL DEFAULT 'beachclub';
ALTER TABLE "Settlement" ADD COLUMN "product" TEXT NOT NULL DEFAULT 'beachclub';
ALTER TABLE "ServiceFee" ADD COLUMN "product" TEXT;

-- AlterTable: soft link Site -> Restaurant (plain FK, no Prisma relation).
ALTER TABLE "Site" ADD COLUMN "restaurant_id" TEXT;

-- AlterTable: layout_element can now belong to a Restaurant instead of a Site.
ALTER TABLE "layout_element"
    ADD COLUMN "restaurant_id" TEXT,
    ALTER COLUMN "site_id" DROP NOT NULL;

-- CreateTable: restaurant
CREATE TABLE "restaurant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "description" TEXT,
    "partner_account_id" TEXT NOT NULL,
    "site_id" TEXT,
    "cuisine_type" TEXT,
    "price_range" INTEGER,
    "average_meal_duration" INTEGER NOT NULL DEFAULT 120,
    "reservation_window" INTEGER NOT NULL DEFAULT 60,
    "layout_width" DOUBLE PRECISION,
    "layout_height" DOUBLE PRECISION,
    "public_on_standalone_app" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurant_pkey" PRIMARY KEY ("id")
);

-- CreateTable: restaurant_table
CREATE TABLE "restaurant_table" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "label" TEXT,
    "capacity" INTEGER NOT NULL,
    "min_party_size" INTEGER NOT NULL DEFAULT 1,
    "shape" TEXT NOT NULL DEFAULT 'square',
    "schematic_x" DOUBLE PRECISION,
    "schematic_y" DOUBLE PRECISION,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurant_table_pkey" PRIMARY KEY ("id")
);

-- CreateTable: table_reservation
CREATE TABLE "table_reservation" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "table_id" TEXT,
    "user_id" TEXT,
    "anon_id" TEXT,
    "from" TIMESTAMP(3) NOT NULL,
    "to" TIMESTAMP(3) NOT NULL,
    "party_size" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "operational_status" TEXT NOT NULL DEFAULT 'expected',
    "guest_name" TEXT NOT NULL,
    "guest_email" TEXT NOT NULL,
    "guest_phone" TEXT,
    "special_requests" TEXT,
    "internal_notes" TEXT,
    "seated_at" TIMESTAMP(3),
    "departed_at" TIMESTAMP(3),
    "reminder_sent_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "table_reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable: menu_item
CREATE TABLE "menu_item" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "image_url" TEXT,
    "category" TEXT NOT NULL DEFAULT 'main',
    "sold_out" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable: restaurant_hours
CREATE TABLE "restaurant_hours" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "open_time" TEXT NOT NULL,
    "close_time" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurant_hours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_slug_key" ON "restaurant"("slug");
CREATE UNIQUE INDEX "restaurant_site_id_key" ON "restaurant"("site_id");
CREATE INDEX "restaurant_partner_account_id_idx" ON "restaurant"("partner_account_id");
CREATE INDEX "restaurant_table_restaurant_id_idx" ON "restaurant_table"("restaurant_id");
CREATE UNIQUE INDEX "restaurant_table_restaurant_id_number_key" ON "restaurant_table"("restaurant_id", "number");
CREATE INDEX "table_reservation_restaurant_id_from_idx" ON "table_reservation"("restaurant_id", "from");
CREATE INDEX "table_reservation_table_id_from_to_idx" ON "table_reservation"("table_id", "from", "to");
CREATE INDEX "menu_item_restaurant_id_idx" ON "menu_item"("restaurant_id");
CREATE INDEX "restaurant_hours_restaurant_id_idx" ON "restaurant_hours"("restaurant_id");
CREATE UNIQUE INDEX "Site_restaurant_id_key" ON "Site"("restaurant_id");
CREATE INDEX "layout_element_restaurant_id_idx" ON "layout_element"("restaurant_id");

-- AddForeignKey: restaurant relations inside the restaurant product
ALTER TABLE "restaurant" ADD CONSTRAINT "restaurant_partner_account_id_fkey"
    FOREIGN KEY ("partner_account_id") REFERENCES "PartnerAccount"("user_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "restaurant_table" ADD CONSTRAINT "restaurant_table_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "table_reservation" ADD CONSTRAINT "table_reservation_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "table_reservation" ADD CONSTRAINT "table_reservation_table_id_fkey"
    FOREIGN KEY ("table_id") REFERENCES "restaurant_table"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "table_reservation" ADD CONSTRAINT "table_reservation_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "menu_item" ADD CONSTRAINT "menu_item_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "restaurant_hours" ADD CONSTRAINT "restaurant_hours_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: layout_element -> restaurant (optional side)
ALTER TABLE "layout_element" ADD CONSTRAINT "layout_element_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Site.restaurant_id is a *soft* link — no Prisma relation on
-- the sunbnb side, but we still want DB-level referential integrity.
-- ON DELETE SET NULL: if a Restaurant is removed, the Sunbnb Site stays but
-- loses its link; the chiringuito can relink to a new Restaurant later.
ALTER TABLE "Site" ADD CONSTRAINT "Site_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "restaurant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CheckConstraint: a layout_element must belong to exactly one of Site or
-- Restaurant (never both, never neither). Enforced at the DB level since
-- Prisma cannot express XOR between relations.
ALTER TABLE "layout_element" ADD CONSTRAINT "layout_element_owner_chk"
    CHECK (
        ("site_id" IS NOT NULL AND "restaurant_id" IS NULL) OR
        ("site_id" IS NULL AND "restaurant_id" IS NOT NULL)
    );
