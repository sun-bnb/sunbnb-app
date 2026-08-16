-- CreateTable
CREATE TABLE "account_feature_flag" (
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "account_feature_flag_pkey" PRIMARY KEY ("account_id","name")
);
