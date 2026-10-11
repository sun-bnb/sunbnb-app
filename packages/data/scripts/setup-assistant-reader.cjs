// Ops step for the `assistant_reader` role (track 030 D1) - run via setup-assistant-reader.sh.
// The migration creates the role NOLOGIN with no secret; this sets what must never be in git:
//   * LOGIN + PASSWORD            from ASSISTANT_DB_PASSWORD
//   * the HMAC claim secret       from ASSISTANT_DB_CLAIM_SECRET (upserted into assistant.claim_secret)
// Values come from the environment only and are never printed or logged.
const pg = require('pg')

const url = process.env.POSTGRES_URL
const password = process.env.ASSISTANT_DB_PASSWORD
const secret = process.env.ASSISTANT_DB_CLAIM_SECRET
const die = (m) => {
  console.error(`setup-assistant-reader: ${m}`)
  process.exit(1)
}
if (!url) die('POSTGRES_URL is not set (run through setup-assistant-reader.sh).')
if (!password || password.length < 24) die('ASSISTANT_DB_PASSWORD must be set (>= 24 chars).')
if (!secret || secret.length < 32) die('ASSISTANT_DB_CLAIM_SECRET must be set (>= 32 chars).')
if (!/^[A-Za-z0-9_\-.~]+$/.test(password)) die('ASSISTANT_DB_PASSWORD must be URL-safe (letters, digits, _-.~) - it is embedded in ASSISTANT_DB_URL.')

async function main() {
const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'assistant_reader'")
  const table = await client.query("SELECT to_regclass('assistant.claim_secret') AS t")
  if (!role.rowCount || !table.rows[0].t) die('migration 20261011120000_assistant_reader_role_and_views is not applied on this database.')
  await client.query(`ALTER ROLE assistant_reader LOGIN PASSWORD ${client.escapeLiteral(password)}`)
  await client.query(
    `INSERT INTO assistant.claim_secret (id, secret) VALUES (1, convert_to($1, 'UTF8'))
     ON CONFLICT (id) DO UPDATE SET secret = excluded.secret`,
    [secret],
  )
  const db = await client.query('SELECT current_database() AS db')
  const host = new URL(url).host
  console.log(`assistant_reader: LOGIN + password set, claim secret upserted (database ${db.rows[0].db} on ${host}).`)
} finally {
  await client.end()
}
}
main().catch((e) => die(e.message))
