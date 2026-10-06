/**
 * One integration run at a time — a vitest `globalSetup` shared by the data, user and partner
 * integration suites (each config points here).
 *
 * All three suites TRUNCATE and reseed the same `sunbnb_test` database (and data also
 * `coastline_test`). Two runs at once — a promote in one terminal, tests in another session —
 * wipe each other's fixtures mid-test and queue behind each other's table locks: on 2026-10-06
 * that showed up as hooks "timing out in 15000ms" after 11–17 MINUTES (the timeout can't fire
 * while a query is blocked), a different 3–5 tests each time, and 54–80 min runs that pass in
 * ~9 min alone.
 *
 * So the run takes a Postgres session-level advisory lock before any test file starts and holds
 * it until the run ends. A second run waits its turn (saying who it waits for) instead of
 * interleaving. The lock dies with its connection, so a killed run never leaves it stuck.
 */
import pg from 'pg'

const TEST_DB_URL = 'postgres://postgres:sunbnb@localhost:5432/sunbnb_test'
/** Arbitrary, fixed: every suite must use the same key. */
const LOCK_KEY = 27_100_627
const MAX_WAIT_MS = 30 * 60_000
const POLL_MS = 2_000

export default async function setup(): Promise<() => Promise<void>> {
  const url = process.env.POSTGRES_URL?.includes('sunbnb_test') ? process.env.POSTGRES_URL : TEST_DB_URL
  const client = new pg.Client({ connectionString: url, application_name: `integration-run ${process.cwd().split('/').slice(-2).join('/')}` })
  await client.connect()

  const started = Date.now()
  let announced = false
  while (!(await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY])).rows[0]!.ok) {
    if (!announced) {
      const { rows } = await client.query<{ app: string; pid: number; age: string }>(
        `SELECT a.application_name AS app, a.pid, date_trunc('second', now() - a.backend_start)::text AS age
         FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
         WHERE l.locktype = 'advisory' AND l.objid = $1 AND l.granted`,
        [LOCK_KEY],
      )
      const who = rows[0] ? `"${rows[0].app}" (pid ${rows[0].pid}, running ${rows[0].age})` : 'another run'
      console.log(`\n[integration] sunbnb_test is in use by ${who} — waiting for it to finish…\n`)
      announced = true
    }
    if (Date.now() - started > MAX_WAIT_MS) {
      await client.end()
      throw new Error(`[integration] gave up after ${MAX_WAIT_MS / 60_000} min waiting for another integration run to release sunbnb_test`)
    }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  if (announced) console.log(`[integration] got sunbnb_test after ${Math.round((Date.now() - started) / 1000)} s`)

  return async () => {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {})
    await client.end()
  }
}
