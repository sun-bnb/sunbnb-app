#!/usr/bin/env bash
#
# setup-assistant-reader.sh <local|integration|test|production>
#
# Ops step after the assistant_reader migration (track 030 D1). Sets LOGIN + PASSWORD on the role
# and upserts the HMAC claim secret, from the environment (never echoed, never in git):
#
#   ASSISTANT_DB_PASSWORD      role password (URL-safe, >= 24 chars)
#   ASSISTANT_DB_CLAIM_SECRET  HMAC secret (>= 32 chars); the app needs the SAME value
#
# If a variable is unset it is read from packages/data/.env.local. Generate fresh values with
#   openssl rand -hex 24   (password)      openssl rand -hex 32   (claim secret)
# Targets (DB URL source): local = POSTGRES_URL, test = POSTGRES_URL_TEST, production =
# POSTGRES_URL_PRODUCTION (all via with-db-url.sh), integration = the local sunbnb_test DB.
#
# The role is CLUSTER-wide: its password is shared by every database on the cluster (local +
# integration share one Docker cluster). The claim secret is per database.
#
# The app's ASSISTANT_DB_URL = the same host/db as the target's connection string with user
# `assistant_reader` and ASSISTANT_DB_PASSWORD, e.g.
#   postgres://assistant_reader:<password>@localhost:5432/postgres                       (local)
#   postgresql://assistant_reader:<password>@<neon-host>/verceldb?sslmode=require        (Neon)
# On Neon, ASSISTANT_DB_URL may be the pooled (-pooler) host or a read-replica host: the design
# needs no writes (replica => session-level advisory-lock abuse cannot touch the primary).
set -euo pipefail

TARGET="${1:-}"
cd "$(dirname "$0")/.."

from_env_file() {
  local key="$1"
  [ -f .env.local ] || return 0
  grep -E "^(export )?${key}=" .env.local | head -1 | sed -E "s/^(export )?${key}=//; s/^[\"']//; s/[\"']$//" || true
}
: "${ASSISTANT_DB_PASSWORD:=$(from_env_file ASSISTANT_DB_PASSWORD)}"
: "${ASSISTANT_DB_CLAIM_SECRET:=$(from_env_file ASSISTANT_DB_CLAIM_SECRET)}"
export ASSISTANT_DB_PASSWORD ASSISTANT_DB_CLAIM_SECRET

case "$TARGET" in
  local)       ./scripts/with-db-url.sh POSTGRES_URL node scripts/setup-assistant-reader.cjs ;;
  test)        ./scripts/with-db-url.sh POSTGRES_URL_TEST node scripts/setup-assistant-reader.cjs ;;
  production)  ./scripts/with-db-url.sh POSTGRES_URL_PRODUCTION node scripts/setup-assistant-reader.cjs ;;
  integration) POSTGRES_URL=postgres://postgres:sunbnb@localhost:5432/sunbnb_test node scripts/setup-assistant-reader.cjs ;;
  *) echo "Usage: setup-assistant-reader.sh <local|integration|test|production>" >&2; exit 64 ;;
esac
