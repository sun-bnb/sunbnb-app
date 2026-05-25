# Sunbnb

Sunbed reservation platform — a Turborepo monorepo with two Next.js apps and shared packages.

## Project structure

```
apps/
  partner/   → B2B portal for venue operators (port 3001)
  user/      → Consumer booking app (port 3002)
packages/
  data/      → Prisma schema, migrations & shared DB client
  ui/        → Common React components
```

## Prerequisites

- **Node.js** (v18+)
- **Docker** (for local PostgreSQL + PostGIS)
- **mkcert** (for local HTTPS certificates)

## Local development setup

### 1. Clone and install dependencies

```bash
git clone <repo-url> && cd sunbnb-app
npm install
```

### 2. Start the database

The project uses a Docker container named `sunbnb-postgres` running the `postgis/postgis` image on port 5432.

**First time — create the container:**

```bash
docker run -d \
  --name sunbnb-postgres \
  -e POSTGRES_PASSWORD=sunbnb \
  -p 5432:5432 \
  postgis/postgis:latest
```

**Subsequent starts:**

```bash
docker start sunbnb-postgres
```

The local connection string is:
```
postgres://postgres:sunbnb@localhost:5432/postgres
```

### 3. Set up environment files

Each app and the data package need `.env.local` files. These are gitignored.

**`packages/data/.env.local`** — used by Prisma for migrations:

```bash
export POSTGRES_URL=postgres://postgres:sunbnb@localhost:5432/postgres
export POSTGRES_URL_TEST=<test-db-connection-string>
```

**`apps/partner/.env.local`:**

```bash
GOOGLE_OAUTH_ID=<your-google-oauth-id>
GOOGLE_OAUTH_SECRET=<your-google-oauth-secret>
AUTH_SECRET=<your-auth-secret>
AUTH_URL=https://local.sunbnb.app:3001
DATABASE_URL=postgres://postgres:sunbnb@localhost:5432/postgres
POSTGRES_URL=postgres://postgres:sunbnb@localhost:5432/postgres
GOOGLE_MAPS_API_KEY=<your-google-maps-key>
GOOGLE_API_SECRET=<your-google-api-secret>
NEXT_PUBLIC_APP_URL=https://local.sunbnb.app:3001
BLOB_READ_WRITE_TOKEN=<your-vercel-blob-token>
```

**`apps/user/.env.local`:**

```bash
GOOGLE_OAUTH_ID=<your-google-oauth-id>
GOOGLE_OAUTH_SECRET=<your-google-oauth-secret>
AUTH_SECRET=<your-auth-secret>
AUTH_URL=https://local.sunbnb.app:3002
DATABASE_URL=postgres://postgres:sunbnb@localhost:5432/postgres
POSTGRES_URL=postgres://postgres:sunbnb@localhost:5432/postgres
GOOGLE_MAPS_API_KEY=<your-google-maps-key>
GOOGLE_API_SECRET=<your-google-api-secret>
NEXT_PUBLIC_APP_URL=https://local.sunbnb.app:3002
STRIPE_PUBLIC_KEY=<your-stripe-public-key>
STRIPE_SECRET_KEY=<your-stripe-secret-key>
BLOB_READ_WRITE_TOKEN=<your-vercel-blob-token>
```

### 4. Run database migrations

```bash
cd packages/data
source .env.local
npm run migrate:local
```

This copies `.env.local` → `.env`, runs `prisma migrate dev`, generates the Prisma client, and migrate-deploys to the `sunbnb_test` integration DB. Migration workflow doctrine lives in `.claude/rules/migrations.md`.

### 5. Set up local HTTPS

Both apps run over HTTPS locally using the hostname `local.sunbnb.app`. You need to:

1. **Add a hosts entry** — add to `/etc/hosts`:
   ```
   127.0.0.1  local.sunbnb.app
   ```

2. **Generate local certificates** (using [mkcert](https://github.com/FiloSottile/mkcert)):
   ```bash
   mkcert -install
   mkcert local.sunbnb.app
   ```

3. **Place the certificates** in each app's `certificates/` directory:
   ```bash
   cp local.sunbnb.app-key.pem apps/partner/certificates/
   cp local.sunbnb.app.pem     apps/partner/certificates/
   cp local.sunbnb.app-key.pem apps/user/certificates/
   cp local.sunbnb.app.pem     apps/user/certificates/
   ```

### 6. Run the apps

**Both apps at once** (via Turborepo):

```bash
npm run dev
```

**Individually:**

```bash
# Partner portal
cd apps/partner
source .env.local
npm run dev
# → https://local.sunbnb.app:3001

# User app
cd apps/user
source .env.local
npm run dev
# → https://local.sunbnb.app:3002
```

> **Note:** `source .env.local` loads the environment variables into your shell before starting the dev server.

## Database management

### Run migrations

```bash
cd packages/data
npm run migrate:local        # local DB (+ sunbnb_test lockstep)
npm run migrate:test         # test (Neon) database
npm run migrate:production   # production database
npm run migrate:check        # verify schema.prisma is captured by committed migrations
npm run migrate:status:{local,test,production}   # pending / failed / drift per env
```

To deploy, use `./promote-to-test.sh` and `./deploy-to-production.sh` from the repo root — they migrate the target DB *before* pushing the branch (migrate-before-deploy). See `.claude/rules/migrations.md`.

### Sync local DB from test

```bash
cd packages/data
source .env.local
./sync-local-db.sh
```

This drops and recreates the local `public` schema, then pipes a `pg_dump` from the test DB.

### Open Prisma Studio

```bash
cd packages/data
source .env.local
npx prisma studio
```

## Deployment

Deployments are managed via Vercel, triggered by git branches:

| Branch | Environment | URL |
|---|---|---|
| `main` | Development | Vercel preview |
| `test` | Test | test.sunbnb.app |
| `production` | Production | sunbnb.app |

```bash
./promote-to-test.sh         # merge main → test
./deploy-to-production.sh    # merge test → production
```
