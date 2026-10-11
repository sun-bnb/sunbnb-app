/**
 * `sql` -- read-only SQL over the open site's data (track 030 D2).
 *
 * The query runs against the REAL database as role `assistant_reader` (`runAssistantSql` in
 * `@repo/data/assistant-claim`). Postgres is the tenant boundary and the column allowlist: the role
 * can only read allowlisted columns of the `assistant.*` views, and row-level security hides every
 * row except those of the site named by an HMAC-signed claim that THIS tool mints from the
 * route-bound `ctx.siteId` / `ctx.accountId` (never from model input). The runner also pins
 * `READ ONLY`, a 3 s statement timeout and `search_path = assistant, public`.
 *
 * The checks below are a SECOND layer and a courtesy to the model (clear early errors): one
 * SELECT/WITH statement, no comments / semicolons / dollar quotes / quoted identifiers, no
 * `SELECT INTO` / `FOR UPDATE` / recursive CTEs, no `pg_*` / `set_config` / admin / file / xml
 * functions (PostGIS `ST_*` is allowed), plus output caps: `MAX_ROWS` rows / `MAX_BYTES` serialized.
 */
import prisma from '@repo/data/PrismaCient'
import { runAssistantSql } from '@repo/data/assistant-claim'
import { assistantDataConfigured, notConfigured } from '../data-access'
import { describeAssistantSchema } from '../sql-schema'
import { defineTool } from './helpers'

export const MAX_ROWS = 200
export const MAX_BYTES = 30_000
export const MAX_QUERY_CHARS = 4_000

const FORBIDDEN_WORDS = ['into', 'recursive', 'nowait']
const FORBIDDEN_FUNCTIONS =
  /\b(pg_\w+|set_config|current_setting|dblink\w*|lo_\w+|query_to_\w+|\w*_to_xml\w*|xml\w*|xpath\w*|repeat|lpad|rpad|txid_\w+|inet_\w+|version|file\w*|read_\w+|copy_\w+)\s*\(/i
const FORBIDDEN_SCHEMAS = /\b(pg_catalog|information_schema|pg_toast|public)\s*\./i

export type SqlCheck = { ok: true; query: string } | { ok: false; error: string; detail?: string }

/** Lexical gate (second layer; Postgres enforces the real boundary). Exported for tests. */
export function checkSql(raw: unknown): SqlCheck {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, error: 'empty_query' }
  if (raw.length > MAX_QUERY_CHARS) return { ok: false, error: 'query_too_long' }
  const query = raw.trim().replace(/;\s*$/, '').trim()
  if (/--|\/\*/.test(query)) return { ok: false, error: 'comments_not_allowed' }
  if (query.includes('$')) return { ok: false, error: 'dollar_quoting_not_allowed' }
  if (query.includes('\\')) return { ok: false, error: 'backslash_not_allowed' }
  // Scan with string literals blanked so `WHERE label = 'delete'` is fine; an unbalanced quote fails.
  const quotes = (query.match(/'/g) ?? []).length
  if (quotes % 2 !== 0) return { ok: false, error: 'unbalanced_quotes' }
  const bare = query.replace(/'(?:[^']|'')*'/g, "''")
  if (bare.includes(';')) return { ok: false, error: 'single_statement_only' }
  if (!/^\(*\s*(select|with)\b/i.test(bare)) return { ok: false, error: 'select_only', detail: 'Start with SELECT or WITH.' }
  // Quoted identifiers could smuggle a function name past the scans ("pg_sleep"); none are needed.
  if (bare.includes('"')) return { ok: false, error: 'quoted_identifiers_not_allowed' }
  const words = new Set(bare.toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? [])
  const word = FORBIDDEN_WORDS.find((w) => words.has(w))
  if (word) return { ok: false, error: 'forbidden_keyword', detail: word.toUpperCase() }
  const fn = FORBIDDEN_FUNCTIONS.exec(bare)
  if (fn) return { ok: false, error: 'forbidden_function', detail: fn[1] }
  if (FORBIDDEN_SCHEMAS.test(bare)) return { ok: false, error: 'forbidden_schema', detail: 'Query the assistant views only (assistant.<view> or the bare view name).' }
  if (/\bfor\s+(update|share|no\s+key|key)\b/i.test(bare)) return { ok: false, error: 'forbidden_keyword', detail: 'FOR UPDATE' }
  return { ok: true, query }
}

/** Map a Postgres / driver error to something the model can act on. Never leaks more than the first message line. */
export function mapSqlError(err: unknown): { ok: false; error: string; detail: string } {
  const e = err as { code?: string; message?: string } | null
  const msg = (e?.message ?? String(err)).split('\n')[0]!.slice(0, 300)
  switch (e?.code) {
    case '42501':
      return { ok: false, error: 'column_not_available', detail: `That column or table is not available to the assistant (${msg}). Use only the documented assistant views and columns.` }
    case '57014': // query_canceled (statement_timeout)
    case '55P03': // lock_not_available (lock_timeout)
      return { ok: false, error: 'query_too_slow', detail: 'The query was too slow and was stopped. Narrow it: add filters, aggregate, or avoid cross joins.' }
    case '42P01':
      return { ok: false, error: 'sql_error', detail: `${msg}. Query only the documented assistant views (inspect data lists them).` }
    default:
      if (/timeout/i.test(msg) && !e?.code) return { ok: false, error: 'query_too_slow', detail: 'The query was too slow and was stopped. Narrow it: add filters, aggregate, or avoid cross joins.' }
      return { ok: false, error: 'sql_error', detail: msg }
  }
}

const jsonSafe = (v: unknown): unknown => (typeof v === 'bigint' ? Number(v) : v instanceof Uint8Array ? '[binary]' : v)

export interface SqlResult {
  ok: true
  columns: string[]
  rows: unknown[][]
  rowCount: number
  truncated: boolean
  totalRows: number | null
}

export type SqlRunCtx = { siteId: string; accountId: string }

/** The site's IANA zone so timestamptz columns render in local time; undefined when unset/invalid. */
export async function siteTimeZone(siteId: string): Promise<string | undefined> {
  try {
    const s = await prisma.site.findUnique({ where: { id: siteId }, select: { timeZone: true } })
    return s?.timeZone && /^[A-Za-z0-9_+\-/]{1,64}$/.test(s.timeZone) ? s.timeZone : undefined
  } catch {
    return undefined
  }
}

/** Run an already-checked query for the bound site through the DB-enforced reader and apply the output caps. */
export async function runChecked(query: string, ctx: SqlRunCtx): Promise<SqlResult | { ok: false; error: string; detail?: string }> {
  const dbCtx = { siteId: ctx.siteId, accountId: ctx.accountId, timeZone: await siteTimeZone(ctx.siteId) }
  try {
    const res = await runAssistantSql(query, [], { ...dbCtx, maxRows: MAX_ROWS })
    const out: unknown[][] = []
    let bytes = 0
    let truncated = res.truncated
    for (const r of res.rows) {
      const row = r.map(jsonSafe)
      bytes += JSON.stringify(row).length
      if (bytes > MAX_BYTES) {
        truncated = true
        break
      }
      out.push(row)
    }
    let totalRows: number | null = out.length
    if (truncated) {
      try {
        const counted = await runAssistantSql(`SELECT count(*) AS n FROM (${query}) _c`, [], { ...dbCtx, maxRows: 1 })
        totalRows = Number(counted.rows[0]?.[0] ?? NaN)
        if (!Number.isFinite(totalRows)) totalRows = null
      } catch {
        totalRows = null
      }
    }
    return { ok: true, columns: res.columns, rows: out, rowCount: out.length, truncated, totalRows }
  } catch (err) {
    return mapSqlError(err)
  }
}

function sqlDescription(): string {
  return [
    "Run ONE read-only SQL query (PostgreSQL dialect, PostGIS ST_* functions available) over THIS site's live data and get columns + rows",
    `(max ${MAX_ROWS} rows; when truncated, totalRows has the real count). Use it for any question about the site's data that the`,
    'specific read tools do not answer directly: counts, sums, averages, comparisons, rankings, date ranges, occupancy, revenue,',
    'price lists. Prefer aggregates over listing rows. SELECT/WITH only; no comments, no semicolons, no quoted identifiers, no',
    'recursive CTEs; queries over ~3 s are stopped. The data is live and already limited to this site: there is no site_id column, never',
    'filter by site. Query the views below by bare name (search_path is pinned to the `assistant` schema; `assistant.<view>` also works);',
    'other schemas and tables are not readable and a column that is not listed is denied. Timestamps are in the site time zone.',
    'Ids are join keys only: refer to parcels by number, seats by seat_label, elements by handle, products by name. Money is EUR, VAT incl.',
    'unless noted. Example: SELECT p.number, count(*) AS seats FROM parcel p JOIN sunbed s ON s.parcel_id = p.id WHERE s.status <> \'pool\'',
    'GROUP BY p.number ORDER BY p.number. Views:',
    describeAssistantSchema(),
  ].join(' ').replace(' Views: ', ' Views:\n')
}

export const sqlTool = defineTool({
  name: 'sql',
  label: 'Querying site data',
  description: sqlDescription(),
  properties: {
    query: { type: 'string', maxLength: MAX_QUERY_CHARS, description: 'One SELECT or WITH statement' },
  },
  required: ['query'],
  async run(input, ctx) {
    if (!assistantDataConfigured()) return notConfigured()
    const checked = checkSql(input.query)
    if (!checked.ok) return checked
    // ctx.siteId / ctx.accountId are route-bound and ownership was re-checked by defineTool; the model never names a site.
    return runChecked(checked.query, { siteId: ctx.siteId, accountId: ctx.accountId })
  },
})
