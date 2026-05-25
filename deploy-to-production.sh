#!/usr/bin/env bash
#
# deploy-to-production.sh — deploy test → production (deploys sunbnb.app).
#
# Migrate-before-deploy: PRODUCTION pending migrations are shown and confirmed,
# then applied BEFORE the branch is pushed, so Vercel never serves new code
# against a schema missing its migration. Promote to test first — this script
# assumes the test branch is already validated.
#
# Migrations run from a developer laptop using the URLs in
# packages/data/.env.local. See .claude/rules/migrations.md for the doctrine.
set -euo pipefail
cd "$(dirname "$0")"
DATA="packages/data"

echo "==> [1/6] Switching to latest test (aborts if the tree is dirty)"
git checkout test
git pull origin test

echo "==> [2/6] Schema captured by migrations? (local DB vs schema.prisma)"
( cd "$DATA" && npm run migrate:check )

echo "==> [3/6] PENDING migrations on PRODUCTION:"
( cd "$DATA" && npm run migrate:status:production )

read -r -p "Apply the above migration(s) to PRODUCTION and deploy? [y/N] " ans
case "$ans" in
  y|Y) ;;
  *) echo "Aborted — nothing applied, nothing deployed."; git checkout main; exit 1 ;;
esac

echo "==> [4/6] Migrating the PRODUCTION database (before deploy)"
( cd "$DATA" && npm run migrate:production )

echo "==> [5/6] Merge test → production and push (Vercel deploys sunbnb.app)"
git checkout production
git pull origin production
git merge test
git push origin production

echo "==> [6/6] Back to main"
git checkout main

echo "✅ Deployed to production — PRODUCTION DB migrated before the deploy."
