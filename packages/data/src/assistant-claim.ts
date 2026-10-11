/**
 * Signed site claim + the read-only query runner for the partner assistant's `sql` tool
 * (track 030 D1). SERVER-ONLY (node:crypto + pg) - never import from a client component.
 *
 * Isolation is enforced by Postgres, not by this file: the `assistant_reader` role can only read
 * allowlisted columns of the `assistant.*` views, and row-level security hides every row except
 * those of the site named by a valid, unexpired, HMAC-signed claim (see the migration
 * `..._assistant_reader_role_and_views`). This module's job is to mint that claim and carry it
 * in ONE read-only transaction via a transaction-local GUC, so a pooled connection (PgBouncer in
 * transaction mode) can never leak a claim from one request to the next.
 *
 *   claim = `${siteId}.${accountId}.${expiresEpochSeconds}.${hex(HMAC-SHA256(secret, first three))}`
 *
 * The caller must already have authorised the user for `siteId` (`requireSiteOwner`) - the claim
 * proves "the server vouched for this site", it does not authenticate anyone.
 *
 * Env: `ASSISTANT_DB_URL` (assistant_reader connection string, may be a read replica) and
 * `ASSISTANT_DB_CLAIM_SECRET` (same value as in `assistant.claim_secret`). Neither the secret nor a
 * claim is ever logged or placed in an error message by this module.
 */
import { createHmac } from 'node:crypto'
import pg from 'pg'

export const MAX_CLAIM_TTL_SEC = 300 // the DB rejects claims expiring > 5 min ahead
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/ // cuids; no '.' (the claim separator)

export interface SignClaimInput {
  siteId: string
  accountId: string
  /** Lifetime in seconds, 1..300. Default 60. */
  ttlSec?: number
}

/** Mint a claim the database will accept for `siteId` until it expires. */
export function signAssistantClaim(input: SignClaimInput, secret: string, nowMs: number = Date.now()): string {
  const { siteId, accountId, ttlSec = 60 } = input
  if (!ID_RE.test(siteId) || !ID_RE.test(accountId)) throw new Error('assistant claim: invalid siteId/accountId')
  if (!secret || secret.length < 32) throw new Error('assistant claim: secret missing or too short')
  if (!Number.isInteger(ttlSec) || ttlSec < 1 || ttlSec > MAX_CLAIM_TTL_SEC) {
    throw new Error(`assistant claim: ttlSec must be an integer 1..${MAX_CLAIM_TTL_SEC}`)
  }
  const expires = Math.floor(nowMs / 1000) + ttlSec
  const body = `${siteId}.${accountId}.${expires}`
  const mac = createHmac('sha256', Buffer.from(secret, 'utf8')).update(body, 'utf8').digest('hex')
  return `${body}.${mac}`
}

export interface AssistantSqlContext {
  siteId: string
  accountId: string
  /** IANA zone applied as the transaction's TimeZone so timestamptz columns render in site-local time. */
  timeZone?: string
  /** Rows returned before `truncated` is set. Default 500, hard max 5000. */
  maxRows?: number
  /** Claim lifetime. Default 60 s. */
  ttlSec?: number
}

export interface AssistantSqlResult {
  columns: string[]
  /** Positional values (a query may legitimately return duplicate column names). */
  rows: unknown[][]
  /** More than `maxRows` rows matched; only the first `maxRows` are returned. */
  truncated: boolean
}

export const DEFAULT_MAX_ROWS = 500
export const HARD_MAX_ROWS = 5000

const TZ_RE = /^[A-Za-z0-9_+\-/]{1,64}$/

const g = globalThis as unknown as { __assistantPool?: { url: string; pool: pg.Pool } }

function getPool(url: string): pg.Pool {
  if (g.__assistantPool && g.__assistantPool.url === url) return g.__assistantPool.pool
  void g.__assistantPool?.pool.end().catch(() => {})
  const pool = new pg.Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    query_timeout: 8_000,
    application_name: 'sunbnb-assistant',
  })
  pool.on('error', () => {}) // idle-client errors must not crash the process
  g.__assistantPool = { url, pool }
  return pool
}

// int8 (count(*)) and numeric (sum/avg of money) arrive as strings by default; models and JSON want numbers.
const INT8 = 20
const NUMERIC = 1700
const types = {
  getTypeParser: (oid: number, format?: 'text' | 'binary') => {
    if (oid === INT8) return (v: string) => Number(v)
    if (oid === NUMERIC) return (v: string) => Number(v)
    return pg.types.getTypeParser(oid, format as 'text')
  },
}

/**
 * Run model-written SQL as `assistant_reader`, scoped to one site by the signed claim.
 *
 * One transaction: `BEGIN READ ONLY` -> `set_config('assistant.claim', claim, true)` (transaction
 * local) -> the query wrapped as `SELECT * FROM (<sql>) _q LIMIT $n` -> `ROLLBACK`. The wrapper
 * always goes through the extended protocol, so a smuggled second statement is a syntax error.
 * `params` are bound as `$1..$k`. Errors from Postgres (permission denied, timeout, syntax ...)
 * propagate as the original `pg` error - callers show `.message` to the model.
 */
export async function runAssistantSql(
  sql: string,
  params: readonly unknown[] = [],
  ctx: AssistantSqlContext,
): Promise<AssistantSqlResult> {
  const url = process.env.ASSISTANT_DB_URL
  const secret = process.env.ASSISTANT_DB_CLAIM_SECRET
  if (!url || !secret) throw new Error('assistant sql: ASSISTANT_DB_URL / ASSISTANT_DB_CLAIM_SECRET not configured')
  if (ctx.timeZone !== undefined && !TZ_RE.test(ctx.timeZone)) throw new Error('assistant sql: invalid timeZone')
  const maxRows = Math.min(Math.max(1, Math.floor(ctx.maxRows ?? DEFAULT_MAX_ROWS)), HARD_MAX_ROWS)
  const claim = signAssistantClaim({ siteId: ctx.siteId, accountId: ctx.accountId, ttlSec: ctx.ttlSec }, secret)

  const inner = sql.trim().replace(/;+\s*$/, '')
  if (!inner) throw new Error('assistant sql: empty query')
  const wrapped = `SELECT * FROM (\n${inner}\n) _q LIMIT $${params.length + 1}`

  const client = await getPool(url).connect()
  let broken = false
  try {
    await client.query('BEGIN READ ONLY')
    // Transaction-local pins, so a session-level `set_config(..., false)` smuggled in by an earlier
    // query on this pooled connection cannot weaken them (DISCARD ALL below is the second layer).
    await client.query({
      text: `SELECT set_config('statement_timeout', '3s', true), set_config('lock_timeout', '2s', true),
                    set_config('search_path', 'assistant, public', true), set_config('assistant.claim', $1, true)`,
      values: [claim],
    })
    if (ctx.timeZone) await client.query({ text: 'SELECT set_config($1, $2, true)', values: ['TimeZone', ctx.timeZone] })
    const res = await client.query({
      text: wrapped,
      values: [...params, maxRows + 1],
      rowMode: 'array',
      types,
    })
    const all = res.rows as unknown[][]
    const truncated = all.length > maxRows
    const rows = (truncated ? all.slice(0, maxRows) : all).map((r) => r.map((v) => (v instanceof Date ? v.toISOString() : v)))
    return { columns: res.fields.map((f) => f.name), rows, truncated }
  } finally {
    try {
      await client.query('ROLLBACK')
      // Drops session state (session-level advisory locks, temp objects, GUCs) before the
      // connection returns to the pool. Best effort: behind a transaction-mode pooler it is a no-op.
      await client.query('DISCARD ALL')
    } catch {
      broken = true
    }
    client.release(broken)
  }
}

/** Close the pool (tests / graceful shutdown). */
export async function closeAssistantPool(): Promise<void> {
  const cur = g.__assistantPool
  g.__assistantPool = undefined
  await cur?.pool.end().catch(() => {})
}
