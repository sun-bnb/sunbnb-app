// Apply coastline/schema.sql (idempotent) to the coastline database: COASTLINE_POSTGRES_URL.
// The coastline DB is outside the app's Prisma migrations by design (track 027) — see schema.sql.
import { readFileSync } from 'node:fs'
import pg from 'pg'

const url = process.env.COASTLINE_POSTGRES_URL
if (!url) {
  console.error('COASTLINE_POSTGRES_URL is not set')
  process.exit(1)
}
const client = new pg.Client({ connectionString: url })
await client.connect()
await client.query(readFileSync(new URL('../coastline/schema.sql', import.meta.url), 'utf8'))
const { rows } = await client.query(`SELECT current_database() db, postgis_version() postgis,
  (SELECT string_agg(tablename, ',' ORDER BY tablename) FROM pg_tables WHERE tablename LIKE 'coast_%' OR tablename LIKE 'inland_%') tables`)
console.log(rows[0])
await client.end()
