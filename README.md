# Sunbnb developer guide

## Local setup
Start the database:
```bash
docker start sunbnb-postgres
```

## Run the Partner app
```bash
cd apps/partner
source .env.local
npm run dev
```

## Run the User app
```bash
cd apps/user
source .env.local
npm run dev
```

## Migrations
```bash
cd packages/data
npm run migrate:[local|test|production]
```

## Deployment
- `git push origin main` (dev env in Vercel)
- `git push origin test` (test.sunbnb.app)
- `git push origin production` (sunbnb.app)
