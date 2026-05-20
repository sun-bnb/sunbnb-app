#!/usr/bin/env bash
# Fresh-clone dev bootstrap (UC3). Idempotent — safe to re-run. Provisions everything it
# safely can; prints a checklist for the steps that need sudo / a manual install.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
say(){ printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

say "Prerequisites"
command -v docker >/dev/null || { echo "✗ Docker not installed — install Docker Desktop, then re-run."; exit 1; }
docker info >/dev/null 2>&1 || { echo "✗ Docker not running — start Docker Desktop, then re-run."; exit 1; }
command -v node >/dev/null || { echo "✗ Node not installed."; exit 1; }
echo "✓ docker + node present"

say "Dependencies"
npm install
( cd .claude/scripts && npm install )

say "App database — sunbnb-postgres (:5432)"
if docker inspect sunbnb-postgres >/dev/null 2>&1; then
  docker start sunbnb-postgres >/dev/null 2>&1 || true; echo "already exists (started)"
else
  docker run -d --name sunbnb-postgres -e POSTGRES_PASSWORD=sunbnb -p 5432:5432 postgis/postgis:latest
fi

say "Knowledge database — sunbnb-knowledge-postgres (:5434, durable)"
if docker inspect sunbnb-knowledge-postgres >/dev/null 2>&1; then
  docker start sunbnb-knowledge-postgres >/dev/null 2>&1 || true; echo "already exists (started)"
else
  docker run -d --name sunbnb-knowledge-postgres --restart unless-stopped \
    -e POSTGRES_PASSWORD=sunbnb -p 5434:5432 \
    -v sunbnb-knowledge-data:/var/lib/postgresql/data pgvector/pgvector:pg17
  for i in $(seq 1 30); do docker exec sunbnb-knowledge-postgres pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
  docker exec sunbnb-knowledge-postgres psql -U postgres -c "CREATE DATABASE sunbnb_knowledge;" 2>/dev/null || true
  docker exec -i sunbnb-knowledge-postgres psql -U postgres -d sunbnb_knowledge < .claude/scripts/knowledge-schema.sql
fi

say "Environment files (from the master)"
if [ -f dev-env.local ]; then
  node scripts/apply-dev-env.mjs --force
else
  echo "✗ dev-env.local not present (it's distributed out-of-band)."
  echo "  Drop it in, then: node scripts/apply-dev-env.mjs --force"
  echo "  (or seed from existing .env.local files: node scripts/apply-dev-env.mjs --seed)"
fi

say "App database schema"
( cd packages/data && npm run migrate:local ) || echo "  ⚠ migrate:local failed — check POSTGRES_URL in packages/data/.env.local"

say "Manual steps (cannot be automated)"
cat <<'EOF'
  • /etc/hosts — ensure this line exists (needs sudo):
        127.0.0.1 local.sunbnb.app
  • mkcert (local HTTPS for partner/user):
        brew install mkcert && mkcert -install
        then generate certs into apps/partner/certificates and apps/user/certificates
  • optional — sync local app DB from the test DB:
        cd packages/data && ./sync-local-db.sh
EOF
printf '\n\033[1mBootstrap complete.\033[0m  Start an app:  cd apps/partner && npm run dev\n'
