/**
 * The `sql` tool (track 030 D2) with `runAssistantSql` mocked: the second-layer statement gate, the
 * claim the tool mints (route-bound site + owner account only), Postgres-error mapping, output caps
 * and the kill switch. The real tenant isolation is Postgres's and is proven against the live
 * `assistant_reader` role in `app/assistant/sql.integration.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

vi.mock('@/app/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('@repo/data/assistant-claim', () => ({ runAssistantSql: vi.fn() }))

import { executeToolCall } from '@repo/agent/loop'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { runAssistantSql } from '@repo/data/assistant-claim'
import { ASSISTANT_VIEWS, DENIED_COLUMN, VIEW_NAMES } from '../sql-schema'
import type { AssistantToolCtx } from './helpers'
import { checkSql, mapSqlError, MAX_BYTES, MAX_ROWS, sqlTool } from './sql'

const OWNER = 'owner-1'
const SITE = 'site-1'
const ctx: AssistantToolCtx = { session: {}, accountId: OWNER, siteId: SITE, locale: 'en' }
const run = vi.mocked(runAssistantSql)

async function sql(query: unknown, c: AssistantToolCtx = ctx) {
  const ex = await executeToolCall([sqlTool], { id: 't1', name: 'sql', arguments: JSON.stringify({ query }) }, c)
  expect(ex.errors).toEqual([])
  return ex.result as Record<string, any>
}
const pgError = (code: string, message: string) => Object.assign(new Error(message), { code })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ASSISTANT_DB_URL = 'postgres://reader@localhost/x'
  process.env.ASSISTANT_DB_CLAIM_SECRET = 'x'.repeat(40)
  vi.mocked(auth).mockResolvedValue({ user: { id: OWNER } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as never)
  vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER, timeZone: 'Europe/Madrid' } as never)
  run.mockResolvedValue({ columns: ['n'], rows: [[3]], truncated: false })
})
afterAll(() => {
  delete process.env.ASSISTANT_DB_URL
  delete process.env.ASSISTANT_DB_CLAIM_SECRET
})

describe('statement gate (second layer)', () => {
  it.each([
    ['multiple statements', 'select 1; select 2', 'single_statement_only'],
    ['DML', 'delete from sunbed', 'select_only'],
    ['DDL', 'create table x (a int)', 'select_only'],
    ['SET', 'set statement_timeout = 0', 'select_only'],
    ['COPY', 'copy sunbed to stdout', 'select_only'],
    ['set_config', "select set_config('search_path', 'x', false)", 'forbidden_function'],
    ['pg_sleep', 'select pg_sleep(10)', 'forbidden_function'],
    ['pg_advisory_lock', 'select pg_advisory_lock(1)', 'forbidden_function'],
    ['pg_read_file', "select pg_read_file('/etc/passwd')", 'forbidden_function'],
    ['catalog access', 'select * from pg_catalog.pg_tables', 'forbidden_schema'],
    ['public schema', 'select * from public.sunbed', 'forbidden_schema'],
    ['recursive CTE', 'with recursive r(n) as (select 1 union all select n + 1 from r) select count(*) from r', 'forbidden_keyword'],
    ['comment hiding a statement', 'select 1 -- ; drop table sunbed', 'comments_not_allowed'],
    ['block comment', 'select /* x */ 1', 'comments_not_allowed'],
    ['dollar quoting', 'select $$x$$', 'dollar_quoting_not_allowed'],
    ['quoted identifier', 'select * from "sunbed"', 'quoted_identifiers_not_allowed'],
    ['SELECT INTO', 'select * into newtab from sunbed', 'forbidden_keyword'],
    ['row locks', 'select * from sunbed for update', 'forbidden_keyword'],
    ['repeat (memory bomb)', "select repeat('x', 1000000000)", 'forbidden_function'],
    ['unbalanced quote', "select 'x", 'unbalanced_quotes'],
    ['empty', '   ', 'empty_query'],
  ])('%s is rejected', (_n, query, error) => {
    expect(checkSql(query)).toMatchObject({ ok: false, error })
  })

  it('no longer rejects what Postgres now enforces: ordinary words, PostGIS, trailing semicolon, keywords in literals', () => {
    expect(checkSql('select 1;')).toEqual({ ok: true, query: 'select 1' })
    expect(checkSql("select count(*) from sunbed where label = 'delete; drop'")).toMatchObject({ ok: true })
    expect(checkSql('select ST_Distance(ST_MakePoint(lng, lat)::geography, ST_MakePoint(-4.4, 36.7)::geography) from sunbed')).toMatchObject({ ok: true })
    expect(checkSql("select d::date from generate_series('2026-07-01'::date, '2026-07-31'::date, '1 day') d")).toMatchObject({ ok: true })
    expect(checkSql('select "user" from x')).toMatchObject({ ok: false }) // still quoted
    expect(checkSql('select set from (select 1 as set) q')).toMatchObject({ ok: true }) // 'set' as a plain word is Postgres's call
    expect(checkSql('with x as (select parcel from assistant.sunbed) select count(*) from x')).toMatchObject({ ok: true })
  })

  it('a rejected query never reaches the database', async () => {
    expect(await sql('select pg_sleep(5)')).toMatchObject({ ok: false, error: 'forbidden_function' })
    expect(run).not.toHaveBeenCalled()
  })
})

describe('what the tool hands the database', () => {
  it('claims the route-bound site and owner account; the model has no way to name another', async () => {
    const r = await sql('select count(*) as n from sunbed')
    expect(r).toMatchObject({ ok: true, columns: ['n'], rows: [[3]], rowCount: 1, truncated: false, totalRows: 1 })
    expect(run).toHaveBeenCalledTimes(1)
    const [query, params, c] = run.mock.calls[0]!
    expect(query).toBe('select count(*) as n from sunbed')
    expect(params).toEqual([])
    expect(c).toMatchObject({ siteId: SITE, accountId: OWNER, timeZone: 'Europe/Madrid', maxRows: MAX_ROWS })
    const tool = sqlTool
    expect(Object.keys((tool.inputSchema as any).properties)).toEqual(['query'])
    expect((tool.inputSchema as any).additionalProperties).toBe(false)
  })

  it('a different bound site gets a different claim', async () => {
    await sql('select 1', { ...ctx, siteId: 'site-2' })
    expect(run.mock.calls[0]![2]).toMatchObject({ siteId: 'site-2', accountId: OWNER })
  })

  it('a non-owner is refused before the database is touched', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: 'someone-else' } as never)
    expect(await sql('select 1')).toEqual({ ok: false, error: 'forbidden' })
    expect(run).not.toHaveBeenCalled()
  })

  it('falls back to the database time zone when the site has none or an unsafe one', async () => {
    vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER, timeZone: "x'; drop" } as never)
    await sql('select 1')
    expect(run.mock.calls[0]![2].timeZone).toBeUndefined()
  })
})

describe('error mapping', () => {
  it('permission denied -> "not available to the assistant"', async () => {
    run.mockRejectedValue(pgError('42501', 'permission denied for table Reservation'))
    expect(await sql('select payment_ref from reservation')).toMatchObject({ ok: false, error: 'column_not_available', detail: expect.stringMatching(/not available to the assistant/) })
  })

  it.each([
    ['statement timeout', pgError('57014', 'canceling statement due to statement timeout')],
    ['lock timeout', pgError('55P03', 'canceling statement due to lock timeout')],
    ['client-side read timeout', new Error('Query read timeout')],
  ])('%s -> query too slow, narrow it', async (_n, err) => {
    run.mockRejectedValue(err)
    const r = await sql('select count(*) from sunbed a, sunbed b')
    expect(r).toMatchObject({ ok: false, error: 'query_too_slow', detail: expect.stringMatching(/Narrow it/) })
  })

  it('syntax / unknown column errors come back as a short first line', async () => {
    run.mockRejectedValue(pgError('42703', 'column "nope" does not exist\nLINE 1: select nope\n  ^'))
    const r = await sql('select nope from sunbed')
    expect(r).toMatchObject({ ok: false, error: 'sql_error', detail: 'column "nope" does not exist' })
  })

  it('mapSqlError never leaks a multi-line server message', () => {
    expect(mapSqlError(pgError('XX000', 'line one\nsecret line two')).detail).toBe('line one')
  })
})

describe('output caps', () => {
  it(`reports the real total when the reader says there are more than ${MAX_ROWS} rows`, async () => {
    run.mockImplementation((async (q: string) =>
      /count\(\*\) AS n FROM/.test(q)
        ? { columns: ['n'], rows: [[250]], truncated: false }
        : { columns: ['seat_label'], rows: Array.from({ length: MAX_ROWS }, (_, i) => [`1-${i}`]), truncated: true }) as never)
    const r = await sql('select seat_label from sunbed order by number')
    expect(r).toMatchObject({ ok: true, rowCount: MAX_ROWS, truncated: true, totalRows: 250 })
  })

  it('caps the serialized size (~30 KB) and says so', async () => {
    run.mockImplementation((async (q: string) =>
      /count\(\*\) AS n FROM/.test(q)
        ? { columns: ['n'], rows: [[150]], truncated: false }
        : { columns: ['x'], rows: Array.from({ length: 150 }, () => ['y'.repeat(1000)]), truncated: false }) as never)
    const r = await sql('select x from sunbed')
    expect(r).toMatchObject({ ok: true, truncated: true, totalRows: 150 })
    expect(JSON.stringify(r.rows).length).toBeLessThanOrEqual(MAX_BYTES)
    expect(r.rowCount).toBeLessThan(150)
  })

  it('a failing count leaves totalRows null instead of failing the query', async () => {
    run.mockImplementation((async (q: string) => {
      if (/count\(\*\) AS n FROM/.test(q)) throw pgError('57014', 'timeout')
      return { columns: ['a'], rows: [[1]], truncated: true }
    }) as never)
    expect(await sql('select a from sunbed')).toMatchObject({ ok: true, truncated: true, totalRows: null })
  })
})

describe('kill switch', () => {
  it.each(['ASSISTANT_DB_URL', 'ASSISTANT_DB_CLAIM_SECRET'])('%s unset -> data_access_not_configured, no throw, no DB call', async (key) => {
    delete process.env[key]
    expect(await sql('select 1')).toMatchObject({ ok: false, reason: 'data_access_not_configured' })
    expect(run).not.toHaveBeenCalled()
  })
})

describe('schema description', () => {
  it('documents every view and column in the tool description, none denied', () => {
    for (const v of ASSISTANT_VIEWS) {
      expect(sqlTool.description).toContain(`${v.name} --`)
      for (const c of v.columns) {
        expect(DENIED_COLUMN.test(c.name), `${v.name}.${c.name}`).toBe(false)
        expect(sqlTool.description).toContain(c.name)
      }
    }
    expect(VIEW_NAMES).toEqual(['site', 'parcel', 'unit', 'sunbed', 'layout_element', 'product', 'rental_item', 'working_hours', 'reservation', 'reservation_seat', 'food_order', 'food_order_item', 'invoice'])
    expect(sqlTool.description).toMatch(/search_path/)
    expect(sqlTool.description).toMatch(/assistant\.<view>/)
  })
})
