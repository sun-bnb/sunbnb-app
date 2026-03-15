# Data Access Rules

- `packages/data` owns the Prisma schema exclusively. Never define models or run migrations from the apps.
- Import database types and client from `@repo/data` — never create separate Prisma instances in apps.
- Status fields are plain String columns, not Prisma enums. Always use constants from `@repo/data/reservation-status`.
- Server components fetch via Prisma directly (no API layer needed). Client components use RTK Query or server actions.
- PostGIS spatial queries use `prisma.$queryRawUnsafe()` with `ST_DistanceSphere`, `ST_MakePoint`, etc. Coordinates stored as `geometry` type with GiST index.
- Server actions return `{ status: 'ok' | 'error', errors?: string[] }`. Follow this pattern for all new actions.
- When creating reservations or orders, always wrap availability check + create in the same operation to minimize race condition windows.
