#!/usr/bin/env bash
#
# promote-to-test.sh — promote main → test (deploys test.sunbnb.app).
#
# The TEST DB is shared with main's preview, so additive migrations were already
# applied before main was pushed (pre-push hook). This step is where DESTRUCTIVE
# (contract) migrations land — once the test branch has caught up past the code
# that used the dropped object — plus an idempotent backstop for the rest.
# migrate:test runs BEFORE the branch is pushed, so test.sunbnb.app never serves
# new code against a schema missing its migration. Guards are mandatory; lint +
# unit tests run by default (SKIP_TESTS=1 bypasses for docs-only promotes).
#
# Migrations run from a developer laptop using the URLs in
# packages/data/.env.local. See .claude/rules/migrations.md for the doctrine.
set -euo pipefail
cd "$(dirname "$0")"
DATA="packages/data"

echo "==> [1/6] Switching to latest main (aborts if the tree is dirty)"
git checkout main
git pull origin main

echo "==> [2/6] Schema captured by migrations? (local DB vs schema.prisma)"
( cd "$DATA" && npm run migrate:check )

echo "==> [3/6] TEST database migration status"
# `prisma migrate status` exits non-zero when migrations are pending (the normal
# pre-promote state) — informational only, so don't let it trip `set -e`. The
# actual migrate at [5/6] still fails loudly on a real problem.
( cd "$DATA" && npm run migrate:status:test ) || true

if [ "${SKIP_TESTS:-0}" = "1" ]; then
  echo "==> [4/6] lint + unit tests SKIPPED (SKIP_TESTS=1)"
else
  echo "==> [4/6] lint + unit tests"
  npm run lint
  npm run test
fi

echo "==> [5/6] Migrating the TEST database (before deploy)"
( cd "$DATA" && npm run migrate:test )

echo "==> [6/6] Merge main → test and push (Vercel deploys test.sunbnb.app)"
git checkout test
git pull origin test
git merge main
git push origin test
git checkout main

echo "✅ Promoted to test — TEST DB migrated before the deploy."
