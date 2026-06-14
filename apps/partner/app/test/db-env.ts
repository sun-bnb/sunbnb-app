/**
 * Integration-test DB pin — registered as a vitest `setupFiles` entry so it runs
 * BEFORE the test module graph (and therefore before `@repo/data` is imported,
 * which captures `connectionString` from POSTGRES_URL at import time — see
 * packages/data/index.ts).
 *
 * Without this, a bare `vitest`/IDE run resolves POSTGRES_URL from this app's
 * `.env.local` to the DEV database and `cleanDatabase()` truncates it. Here we
 * force the dedicated throwaway test DB unless POSTGRES_URL already points at a
 * `sunbnb_test` database. The connection-level guard in setup.ts's
 * `cleanDatabase()` is the hard backstop; this is the convenience layer that
 * makes such runs target the right DB instead of throwing.
 */
const TEST_DB_URL = 'postgres://postgres:sunbnb@localhost:5432/sunbnb_test'

if (!process.env.POSTGRES_URL || !process.env.POSTGRES_URL.includes('sunbnb_test')) {
  process.env.POSTGRES_URL = TEST_DB_URL
}
