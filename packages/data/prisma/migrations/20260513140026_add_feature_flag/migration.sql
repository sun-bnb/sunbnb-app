-- Runtime feature flag overrides. The static FLAG_REGISTRY in
-- `packages/data/src/flags.ts` is the source of truth for what flags exist
-- and their per-environment defaults. Rows here override the default for the
-- whole deployment.

CREATE TABLE "feature_flag" (
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "feature_flag_pkey" PRIMARY KEY ("name")
);
