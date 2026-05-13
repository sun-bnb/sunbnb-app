-- Audit + replay-protection record for admin impersonation handoffs.
-- The unique constraint on `token_id` is the replay guard: a second
-- consumption attempt fails with a unique violation, which the service
-- translates to a replay error.

CREATE TABLE "impersonation_log" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "target_user_id" TEXT NOT NULL,
    "token_id" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "impersonation_log_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "impersonation_log_token_id_key" ON "impersonation_log"("token_id");
CREATE INDEX "impersonation_log_admin_id_started_at_idx" ON "impersonation_log"("admin_id", "started_at");
CREATE INDEX "impersonation_log_target_user_id_started_at_idx" ON "impersonation_log"("target_user_id", "started_at");
