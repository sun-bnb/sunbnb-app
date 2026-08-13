/**
 * Tests for GET /api/hw/[code]/state — the device state route (track 019 P1).
 *
 * The contract (`.claude/tracks/019-hw-api.md`) is a long-lived compatibility
 * surface: once devices are potted these assertions are what stops a refactor
 * from silently changing what a fielded LED bar shows. Three properties matter
 * more than the happy path and are tested hardest:
 *
 *   - **Never FREE on doubt** — every failure mode must be non-200 or OCCUPIED.
 *   - **Uniform 401** — an unknown code must be byte-identical to a bad token.
 *   - **Binding order** — `seats[]` follows the mount order, not the DB's.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

import { GET } from './route'
// Pure helpers live in ./projection — a Next route file may export only the
// handlers and config fields, which `next build` enforces and tsc/lint do not.
import { normalizeCode, wireStateFor, aggregateState } from './projection'
import prisma from '@repo/data/PrismaCient'

const mockItems = vi.mocked(prisma.inventoryItem.findMany)
const mockReservations = vi.mocked(prisma.reservation.findMany)

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TOKEN = 'test-hw-token'
const CODE = '7QK3M2'
const SEAT_A = 'clxseat0000000000000000001'
const SEAT_B = 'clxseat0000000000000000002'

const SITE = { timeZone: 'Europe/Madrid', locationLat: '36.5', locationLng: '-4.9' }

function seat(id: string, number: number, seatLabel: string | null = null) {
  return { id, number, seatLabel, siteId: 'site-1', site: SITE }
}

/** A reservation row in the shape the route selects. */
function reservation(opts: {
  itemIds: string[]
  status?: string
  operationalStatus?: string
  todayOperationalStatus?: string | null
  isComp?: boolean
  settled?: boolean
  /** Days from now that the stay ends. Negative/0 ⇒ stay is over today. */
  endsInDays?: number
}) {
  const to = new Date()
  to.setDate(to.getDate() + (opts.endsInDays ?? 0))
  // Push to end-of-day so a same-day `to` is not accidentally before endOfToday's
  // boundary in the venue tz.
  if ((opts.endsInDays ?? 0) <= 0) to.setHours(0, 0, 0, 0)

  return {
    status: opts.status ?? 'complete',
    operationalStatus: opts.operationalStatus ?? 'expected',
    isComp: opts.isComp ?? false,
    to,
    items: opts.itemIds.map((id) => ({ id })),
    tillEntries: opts.settled ? [{ id: 'till-1' }] : [],
    days:
      opts.todayOperationalStatus === undefined
        ? [{ operationalStatus: opts.operationalStatus ?? 'expected' }]
        : opts.todayOperationalStatus === null
          ? []
          : [{ operationalStatus: opts.todayOperationalStatus }],
  }
}

function makeRequest(code = CODE, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:3002/api/hw/${code}/state`, {
    headers: { authorization: `Bearer ${TOKEN}`, ...headers },
  })
}

function makeParams(code = CODE) {
  return { params: { code } }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.HW_TOKEN = TOKEN
  process.env.HW_DEVICE_MAP = JSON.stringify({ [CODE]: [SEAT_A, SEAT_B] })
  mockItems.mockResolvedValue([seat(SEAT_A, 12), seat(SEAT_B, 13)] as never)
  mockReservations.mockResolvedValue([] as never)
})

// ── Auth: the uniform-401 rule ────────────────────────────────────────────────

describe('auth', () => {
  it('401s with no Authorization header', async () => {
    const req = new NextRequest(`http://localhost:3002/api/hw/${CODE}/state`)
    const res = await GET(req, makeParams())
    expect(res.status).toBe(401)
  })

  it('401s on a wrong token', async () => {
    const res = await GET(makeRequest(CODE, { authorization: 'Bearer nope' }), makeParams())
    expect(res.status).toBe(401)
  })

  it('401s on a non-Bearer scheme', async () => {
    const res = await GET(makeRequest(CODE, { authorization: `Basic ${TOKEN}` }), makeParams())
    expect(res.status).toBe(401)
  })

  it('an unknown code is INDISTINGUISHABLE from a bad token', async () => {
    const unknown = await GET(makeRequest('ZZZZZZ'), makeParams('ZZZZZZ'))
    const badToken = await GET(makeRequest(CODE, { authorization: 'Bearer nope' }), makeParams())

    expect(unknown.status).toBe(401)
    expect(badToken.status).toBe(401)
    // Byte-identical bodies: a caller must not learn that a code exists.
    expect(await unknown.json()).toEqual(await badToken.json())
  })

  it('never queries the database for an unknown code', async () => {
    await GET(makeRequest('ZZZZZZ'), makeParams('ZZZZZZ'))
    expect(mockItems).not.toHaveBeenCalled()
  })

  it('503s when HW_TOKEN is not configured (never 200, never FREE)', async () => {
    delete process.env.HW_TOKEN
    const res = await GET(makeRequest(), makeParams())
    expect(res.status).toBe(503)
  })
})

// ── Binding ───────────────────────────────────────────────────────────────────

describe('binding', () => {
  it('401s when HW_DEVICE_MAP is unset', async () => {
    delete process.env.HW_DEVICE_MAP
    const res = await GET(makeRequest(), makeParams())
    expect(res.status).toBe(401)
  })

  it('401s when HW_DEVICE_MAP is malformed JSON', async () => {
    process.env.HW_DEVICE_MAP = '{not json'
    const res = await GET(makeRequest(), makeParams())
    expect(res.status).toBe(401)
  })

  it('401s when the code maps to an empty seat list', async () => {
    process.env.HW_DEVICE_MAP = JSON.stringify({ [CODE]: [] })
    const res = await GET(makeRequest(), makeParams())
    expect(res.status).toBe(401)
  })

  it('503s when a bound seat no longer exists — a partial truth is not served', async () => {
    mockItems.mockResolvedValue([seat(SEAT_A, 12)] as never)
    const res = await GET(makeRequest(), makeParams())
    expect(res.status).toBe(503)
  })

  it('503s when bound seats span more than one site', async () => {
    mockItems.mockResolvedValue([
      seat(SEAT_A, 12),
      { ...seat(SEAT_B, 13), siteId: 'site-2' },
    ] as never)
    const res = await GET(makeRequest(), makeParams())
    expect(res.status).toBe(503)
  })

  it('emits seats in BINDING order, not database order', async () => {
    // DB returns B first; the binding says A is the leftmost LED segment.
    mockItems.mockResolvedValue([seat(SEAT_B, 13), seat(SEAT_A, 12)] as never)
    const res = await GET(makeRequest(), makeParams())
    const body = await res.json()
    expect(body.seats.map((s: { id: string }) => s.id)).toEqual([SEAT_A, SEAT_B])
  })

  it('normalises a Crockford-ambiguous, lowercase code', async () => {
    // Stored form is the normalised one: '7qk3il' → uppercase → I and L fold to 1.
    process.env.HW_DEVICE_MAP = JSON.stringify({ '7QK311': [SEAT_A, SEAT_B] })
    const res = await GET(makeRequest('7qk3il'), makeParams('7qk3il'))
    expect(res.status).toBe(200)
    expect((await res.json()).code).toBe('7QK311')
  })
})

// ── State derivation ──────────────────────────────────────────────────────────

describe('state derivation', () => {
  async function stateFor(rows: ReturnType<typeof reservation>[]): Promise<string> {
    mockReservations.mockResolvedValue(rows as never)
    const res = await GET(makeRequest(), makeParams())
    expect(res.status).toBe(200)
    return (await res.json()).seats[0].state
  }

  it('FREE with no reservations', async () => {
    expect(await stateFor([])).toBe('FREE')
  })

  it('RESERVED for an expected online booking', async () => {
    expect(await stateFor([reservation({ itemIds: [SEAT_A] })])).toBe('RESERVED')
  })

  it('OCCUPIED for a checked-in guest', async () => {
    expect(
      await stateFor([reservation({ itemIds: [SEAT_A], operationalStatus: 'checked-in' })]),
    ).toBe('OCCUPIED')
  })

  it('OCCUPIED for a walked-in guest', async () => {
    expect(
      await stateFor([
        reservation({
          itemIds: [SEAT_A],
          status: 'paid-in-cash',
          operationalStatus: 'walked-in',
          settled: true,
        }),
      ]),
    ).toBe('OCCUPIED')
  })

  it('UNAVAILABLE for a blocked bed', async () => {
    expect(
      await stateFor([reservation({ itemIds: [SEAT_A], operationalStatus: 'blocked' })]),
    ).toBe('UNAVAILABLE')
  })

  it('RESERVED for a held bed (no money yet)', async () => {
    expect(await stateFor([reservation({ itemIds: [SEAT_A], status: 'held' })])).toBe('RESERVED')
  })

  it('RESERVED for a pending-payment booking', async () => {
    expect(await stateFor([reservation({ itemIds: [SEAT_A], status: 'pending' })])).toBe(
      'RESERVED',
    )
  })

  it('FREE once a departed guest’s stay is over (released)', async () => {
    expect(
      await stateFor([
        reservation({ itemIds: [SEAT_A], operationalStatus: 'departed', endsInDays: 0 }),
      ]),
    ).toBe('FREE')
  })

  it('RESERVED for a MIDSTAY departure — future days still hold the bed (track 012)', async () => {
    expect(
      await stateFor([
        reservation({ itemIds: [SEAT_A], operationalStatus: 'departed', endsInDays: 3 }),
      ]),
    ).toBe('RESERVED')
  })

  it('RESERVED for a no-show whose stay is not over', async () => {
    expect(
      await stateFor([
        reservation({ itemIds: [SEAT_A], operationalStatus: 'no-show', endsInDays: 3 }),
      ]),
    ).toBe('RESERVED')
  })

  it('a failed booking does not mask a real one on the same seat', async () => {
    expect(
      await stateFor([
        reservation({ itemIds: [SEAT_A], status: 'payment_failed' }),
        reservation({ itemIds: [SEAT_A], operationalStatus: 'checked-in' }),
      ]),
    ).toBe('OCCUPIED')
  })
})

// ── The read-only today-row rule ──────────────────────────────────────────────

describe('today-row resolution (read-only)', () => {
  async function stateFor(row: ReturnType<typeof reservation>): Promise<string> {
    mockReservations.mockResolvedValue([row] as never)
    const res = await GET(makeRequest(), makeParams())
    return (await res.json()).seats[0].state
  }

  it('a multiday guest checked in YESTERDAY reads RESERVED today, not OCCUPIED', async () => {
    // No ReservationDay row for today yet (the device polls before staff open the
    // grid). Falling back to the parent column would wrongly read `checked-in`.
    const state = await stateFor(
      reservation({
        itemIds: [SEAT_A],
        operationalStatus: 'checked-in',
        todayOperationalStatus: null,
        endsInDays: 2,
      }),
    )
    expect(state).toBe('RESERVED')
  })

  it('a walk-in with no row today still reads present (parent tracks directly)', async () => {
    const state = await stateFor(
      reservation({
        itemIds: [SEAT_A],
        status: 'paid-in-cash',
        operationalStatus: 'walked-in',
        todayOperationalStatus: null,
        settled: true,
        endsInDays: 2,
      }),
    )
    expect(state).toBe('OCCUPIED')
  })

  it("today's row wins over the parent column when it exists", async () => {
    const state = await stateFor(
      reservation({
        itemIds: [SEAT_A],
        operationalStatus: 'expected',
        todayOperationalStatus: 'checked-in',
        endsInDays: 2,
      }),
    )
    expect(state).toBe('OCCUPIED')
  })

  it('a blocked bed ignores the today row entirely', async () => {
    const state = await stateFor(
      reservation({
        itemIds: [SEAT_A],
        operationalStatus: 'blocked',
        todayOperationalStatus: null,
      }),
    )
    expect(state).toBe('UNAVAILABLE')
  })

  it('does not write a ReservationDay row while serving a poll', async () => {
    await GET(makeRequest(), makeParams())
    // 1.3M polls/day must not become 1.3M upserts. The mock has no
    // reservationDay model at all — this asserts the shape of the query set.
    expect(mockReservations).toHaveBeenCalledTimes(1)
    expect(mockItems).toHaveBeenCalledTimes(1)
  })
})

// ── Aggregate ─────────────────────────────────────────────────────────────────

describe('aggregate', () => {
  it('FREE only when every seat is FREE', () => {
    expect(aggregateState(['FREE', 'FREE'])).toBe('FREE')
    expect(aggregateState(['FREE', 'RESERVED'])).toBe('RESERVED')
  })

  it('reports the most blocking member', () => {
    expect(aggregateState(['RESERVED', 'OCCUPIED'])).toBe('OCCUPIED')
    expect(aggregateState(['OCCUPIED', 'UNAVAILABLE'])).toBe('UNAVAILABLE')
    expect(aggregateState(['FREE', 'UNAVAILABLE', 'RESERVED'])).toBe('UNAVAILABLE')
  })

  it('an empty binding cannot aggregate to anything but FREE', () => {
    expect(aggregateState([])).toBe('FREE')
  })

  it('mixes per-seat states into one aggregate over the wire', async () => {
    mockReservations.mockResolvedValue([
      reservation({ itemIds: [SEAT_B], operationalStatus: 'checked-in' }),
    ] as never)
    const body = await (await GET(makeRequest(), makeParams())).json()
    expect(body.seats.map((s: { state: string }) => s.state)).toEqual(['FREE', 'OCCUPIED'])
    expect(body.state).toBe('OCCUPIED')
  })
})

// ── Fail-safe direction ───────────────────────────────────────────────────────

describe('fail-safe', () => {
  it('an unrecognised compound state reads OCCUPIED, never FREE', () => {
    expect(
      wireStateFor({ kind: 'online', pay: 'complete', occ: 'wat' as never, released: false }),
    ).toBe('OCCUPIED')
  })

  it('503s when the database throws — the device shows amber, not green', async () => {
    mockReservations.mockRejectedValue(new Error('connection lost') as never)
    const res = await GET(makeRequest(), makeParams())
    expect(res.status).toBe(503)
  })

  it('leaks no internal detail in an error body', async () => {
    mockReservations.mockRejectedValue(new Error('connection lost at 10.0.0.5') as never)
    const body = await (await GET(makeRequest(), makeParams())).json()
    expect(JSON.stringify(body)).not.toContain('10.0.0.5')
  })
})

// ── Wire shape & caching ──────────────────────────────────────────────────────

describe('wire shape', () => {
  it('returns the documented envelope', async () => {
    const res = await GET(makeRequest(), makeParams())
    const body = await res.json()

    expect(body).toMatchObject({
      code: CODE,
      state: 'FREE',
      pollAfterSec: 60,
      cmd: null,
    })
    expect(body.seats).toEqual([
      { id: SEAT_A, label: '12', state: 'FREE' },
      { id: SEAT_B, label: '13', state: 'FREE' },
    ])
    expect(typeof body.serverTime).toBe('string')
  })

  it('prefers seatLabel over the seat number for the label', async () => {
    mockItems.mockResolvedValue([seat(SEAT_A, 12, 'A12'), seat(SEAT_B, 13)] as never)
    const body = await (await GET(makeRequest(), makeParams())).json()
    expect(body.seats.map((s: { label: string }) => s.label)).toEqual(['A12', '13'])
  })

  it('sets no-store and an ETag', async () => {
    const res = await GET(makeRequest(), makeParams())
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('etag')).toMatch(/^"[0-9a-f]{32}"$/)
  })

  it('304s when If-None-Match matches', async () => {
    const first = await GET(makeRequest(), makeParams())
    const etag = first.headers.get('etag')!

    const second = await GET(makeRequest(CODE, { 'if-none-match': etag }), makeParams())
    expect(second.status).toBe(304)
    expect(second.headers.get('etag')).toBe(etag)
  })

  it('the ETag excludes serverTime — an unchanged seat state stays a 304', async () => {
    const first = await GET(makeRequest(), makeParams())
    await new Promise((r) => setTimeout(r, 5))
    const second = await GET(makeRequest(), makeParams())
    expect(second.headers.get('etag')).toBe(first.headers.get('etag'))
  })

  it('the ETag changes when a seat state changes', async () => {
    const before = (await GET(makeRequest(), makeParams())).headers.get('etag')

    mockReservations.mockResolvedValue([
      reservation({ itemIds: [SEAT_A], operationalStatus: 'checked-in' }),
    ] as never)
    const after = (await GET(makeRequest(), makeParams())).headers.get('etag')

    expect(after).not.toBe(before)
  })
})

// ── Pure helpers ──────────────────────────────────────────────────────────────

describe('normalizeCode', () => {
  it('uppercases and folds the Crockford ambiguities', () => {
    expect(normalizeCode('7qk3m2')).toBe('7QK3M2')
    expect(normalizeCode(' 7qk3m2 ')).toBe('7QK3M2')
    expect(normalizeCode('IL0O')).toBe('1100')
  })
})
