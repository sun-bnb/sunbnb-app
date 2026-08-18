-- CreateTable
CREATE TABLE "platform_preference" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "platform_preference_pkey" PRIMARY KEY ("key")
);
