#!/usr/bin/env bash
#
# with-db-url.sh <ENV_KEY> <command...>
#
# Extracts <ENV_KEY> from packages/data/.env.local, exports its value as
# POSTGRES_URL, and runs <command...> with that override in place.
#
# Why: .env.local is the single source for all three DB URLs (POSTGRES_URL =
# local, POSTGRES_URL_TEST, POSTGRES_URL_PRODUCTION). An inline POSTGRES_URL
# wins over whatever prisma.config.ts loads from .env via dotenv (dotenv does
# not override an already-set var), so we can point a Prisma command at any
# environment WITHOUT rewriting .env — no transient prod-creds-in-.env window,
# no restore step. Run from the packages/data directory (npm scripts already do).
set -euo pipefail

KEY="${1:-}"
shift || true
if [ -z "$KEY" ] || [ "$#" -eq 0 ]; then
  echo "Usage: with-db-url.sh <ENV_KEY> <command...>" >&2
  exit 64
fi

ENV_FILE=".env.local"
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found — run from packages/data." >&2
  exit 1
fi

# Strip an optional `export ` prefix, the `KEY=` lead, and surrounding quotes.
VALUE="$(grep -E "^(export )?${KEY}=" "$ENV_FILE" | head -1 | sed -E "s/^(export )?${KEY}=//; s/^[\"']//; s/[\"']$//" || true)"
if [ -z "$VALUE" ]; then
  echo "Error: $KEY is not set in $ENV_FILE." >&2
  exit 1
fi

# Force the DIRECT (non-pooled) Neon endpoint for every Prisma command run here.
#
# Prisma Migrate takes a SESSION-level advisory lock (SELECT pg_advisory_lock).
# Neon's `-pooler` host is PgBouncer in transaction-pooling mode, which cannot
# hold a session lock, and the compute auto-suspends — hence the intermittent
# P1002 "Timed out trying to acquire a postgres advisory lock" on a cold start
# (it only succeeds once the compute happens to be warm). Dropping the `-pooler`
# label yields the direct endpoint, where the lock is taken on the real backend
# session. No-op for the already-direct local URL, and it does NOT touch the
# app's runtime connection (that reads POSTGRES_URL from Vercel env, never this
# wrapper) — only CLI migrate/status/check/diff go through here.
VALUE="${VALUE/-pooler./.}"

POSTGRES_URL="$VALUE" "$@"
