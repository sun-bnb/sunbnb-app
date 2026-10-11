/**
 * `sql` — read-only SQL over the open site's data snapshot (track 030 G1).
 *
 * The model's query never touches the real database: it runs against `snapshot/load.ts`'s
 * per-site PGlite copy, which holds only this site's allowlisted rows. The checks below are
 * defence in depth on top of that isolation:
 *  1. lexical: one SELECT/WITH statement; no `;`, comments, dollar quotes, DDL/DML/session/
 *     transaction keywords, RECURSIVE, `pg_*` / `set_config` / admin / file / xml functions;
 *  2. planner cost gate: `EXPLAIN` the query and refuse above `MAX_COST`. PGlite ignores
 *     `statement_timeout` (single-threaded WASM, measured: a 3e8-row generate_series ran 53 s),
 *     so a runaway query is refused BEFORE it runs rather than cancelled while running;
 *  3. execution inside a READ ONLY transaction that is always rolled back, wrapped as
 *     `SELECT * FROM (q) LIMIT n+1` so the executor stops after the row cap (a data-modifying
 *     CTE is a syntax error inside a subquery);
 *  4. output cap: `MAX_ROWS` rows / `MAX_BYTES` serialized; truncation reports the true total.
 */
import type { PGlite } from '@electric-sql/pglite'
import { getSnapshot } from '../snapshot/load'
import { describeSnapshotSchema } from '../snapshot/schema'
import { defineTool } from './helpers'

export const MAX_ROWS = 200
export const MAX_BYTES = 30_000
export const MAX_QUERY_CHARS = 4_000
/** Planner cost units. A hash join of 20k reservations x 4k seats is ~3e3; a 4k x 4k cross join is ~2.3e5 (seconds in PGlite). */
export const MAX_COST = 50_000

const FORBIDDEN_WORDS = [
  'insert', 'update', 'delete', 'merge', 'upsert', 'drop', 'create', 'alter', 'truncate', 'grant', 'revoke', 'copy',
  'set', 'reset', 'show', 'do', 'call', 'execute', 'prepare', 'deallocate', 'listen', 'notify', 'unlisten', 'vacuum',
  'analyze', 'analyse', 'cluster', 'reindex', 'lock', 'begin', 'start', 'commit', 'rollback', 'abort', 'savepoint',
  'release', 'discard', 'load', 'import', 'comment', 'security', 'refresh', 'checkpoint', 'recursive', 'into', 'extension',
  'function', 'procedure', 'trigger', 'role', 'user', 'session_user', 'current_user', 'database', 'tablespace', 'nowait',
]
const FORBIDDEN_FUNCTIONS =
  /\b(pg_\w+|set_config|current_setting|dblink\w*|lo_\w+|query_to_\w+|\w*_to_xml\w*|xml\w*|xpath\w*|repeat|lpad|rpad|txid_\w+|inet_\w+|version|file\w*|read_\w+|copy_\w+)\s*\(/i
const FORBIDDEN_SCHEMAS = /\b(pg_catalog|information_schema|pg_toast|public)\s*\./i

export type SqlCheck = { ok: true; query: string } | { ok: false; error: string; detail?: string }

/** Lexical gate. Exported for tests. */
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
  // Quoted identifiers could smuggle a keyword past the word scan ("DELETE"); none are needed.
  if (bare.includes('"')) return { ok: false, error: 'quoted_identifiers_not_allowed' }
  const words = new Set(bare.toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? [])
  const word = FORBIDDEN_WORDS.find((w) => words.has(w))
  if (word) return { ok: false, error: 'forbidden_keyword', detail: word.toUpperCase() }
  const fn = FORBIDDEN_FUNCTIONS.exec(bare)
  if (fn) return { ok: false, error: 'forbidden_function', detail: fn[1] }
  if (FORBIDDEN_SCHEMAS.test(bare)) return { ok: false, error: 'forbidden_schema' }
  if (/\bfor\s+(update|share|no\s+key|key)\b/i.test(bare)) return { ok: false, error: 'forbidden_keyword', detail: 'FOR UPDATE' }
  return { ok: true, query }
}

type PlanRow = { 'QUERY PLAN': Array<{ Plan: { 'Total Cost': number; 'Plan Rows': number } }> }

const shortError = (err: unknown) => (err instanceof Error ? err.message : String(err)).split('\n')[0]!.slice(0, 300)

const jsonSafe = (v: unknown): unknown =>
  typeof v === 'bigint' ? Number(v) : v instanceof Date ? v.toISOString() : v instanceof Uint8Array ? '[binary]' : v

export interface SqlResult {
  ok: true
  columns: string[]
  rows: unknown[][]
  rowCount: number
  truncated: boolean
  totalRows: number | null
  dataAsOf: string
}

/** Run a checked query against a snapshot DB. Exported for tests (they pass a PGlite directly). */
export async function runReadOnly(db: PGlite, query: string): Promise<SqlResult | { ok: false; error: string; detail?: string }> {
  return db.transaction(async (tx) => {
    try {
      await tx.exec('SET TRANSACTION READ ONLY')
      const plan = await tx.query<PlanRow>(`EXPLAIN (FORMAT JSON) ${query}`)
      const cost = plan.rows[0]?.['QUERY PLAN'][0]?.Plan['Total Cost'] ?? Infinity
      if (!(cost <= MAX_COST)) {
        return { ok: false as const, error: 'query_too_expensive', detail: `estimated cost ${Math.round(cost)} > ${MAX_COST}; add filters, aggregate, or avoid cross joins` }
      }
      // Array rows: a join may legitimately return two columns with the same name.
      const res = await tx.query<unknown[]>(`SELECT * FROM (${query}) AS _q LIMIT ${MAX_ROWS + 1}`, [], { rowMode: 'array' })
      const columns = res.fields.map((f) => f.name)
      const out: unknown[][] = []
      let bytes = 0
      let truncated = res.rows.length > MAX_ROWS
      for (const r of res.rows.slice(0, MAX_ROWS)) {
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
        // The full query already passed the cost gate, so counting it is bounded too.
        const counted = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${query}) AS _q`)
        totalRows = counted.rows[0]?.n ?? null
      }
      return { ok: true as const, columns, rows: out, rowCount: out.length, truncated, totalRows, dataAsOf: '' }
    } catch (err) {
      return { ok: false as const, error: 'sql_error', detail: shortError(err) }
    } finally {
      await tx.rollback().catch(() => {})
    }
  })
}

function sqlDescription(): string {
  return [
    'Run ONE read-only SQL query (PostgreSQL 17 dialect) over a private copy of THIS site\'s data and get columns + rows (max',
    `${MAX_ROWS} rows; when truncated, totalRows has the real count). Use it for any question about the site's data that the`,
    'specific read tools do not answer directly: counts, sums, averages, comparisons, rankings, date ranges, "which/how many",',
    'occupancy, revenue, price lists. Prefer aggregates over listing rows. SELECT/WITH only; no comments, no semicolons, no',
    'quoted identifiers, no recursive CTEs; very expensive queries (cross joins) are refused. Timestamps are in the site time',
    'zone. The copy may be up to a few minutes old (snapshot_info.loaded_at). ids are join keys only: refer to parcels by',
    'number, seats by seat_label, elements by handle, products by name. Money is EUR, VAT incl. unless noted. Tables:',
    describeSnapshotSchema(),
  ].join(' ').replace(' Tables: ', ' Tables:\n')
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
    const checked = checkSql(input.query)
    if (!checked.ok) return checked
    // ctx.siteId is route-bound and ownership was re-checked by defineTool; the model never names a site.
    let snap = await getSnapshot(ctx.siteId)
    if (snap.db.closed) snap = await getSnapshot(ctx.siteId) // evicted between lookup and use
    const result = await runReadOnly(snap.db, checked.query)
    return result.ok ? { ...result, dataAsOf: snap.loadedAt.toISOString() } : result
  },
})
