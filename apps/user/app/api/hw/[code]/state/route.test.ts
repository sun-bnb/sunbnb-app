/**
 * Tests for GET /api/hw/[code]/state — the device state route (track 019 P1).
 *
 * The contract (`.claude/tracks/019-hw-api.md`) is a long-lived compatibility
 * surface: once devices are potted these assertions are what stops a refactor
 * from silently changing what a fielded LED bar shows. Three properties matter
 * more than the happy path and are tested hardest:
 *
 *   - **Never FREE on doubt** — every failure mode must be non-200 or OCCUPIED.
 *   - **The soft client filter** (Q9) — scanner traffic is declined pre-DB, and an
 *     unset config fails CLOSED rather than opening the endpoint.
 *   - **Binding order** — `seats[]` follows the mount order, not the DB's.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

import { GET } from './route'
// Pure helpers live in ./projection — a Next route file may export only the
// handlers and config fields, which `next build` enforces and tsc/lint do not.
import { wireStateFor, aggregateState } from './projection'
// Code normalisation is a code-identity concern and lives with the shared filter.
import { normalizeCode } from '../hw-filter'
import prisma from '@repo/data/PrismaCient'

const mockItems = vi.mocked(prisma.inventoryItem.findMany)
const mockDevice = vi.mocked(prisma.device.findUnique)

/**
 * A device row in the shape hw-filter selects (track 021 P5): an ASSIGNED
 * LOCATION rather than a stored seat list. The seats are resolved from that
 * location per request, so they come from the item query below, not from here.
 *
 * Row 0 is deliberate: the fixtures' seat numbers (12, 13) decode to parcel 0,
 * row 0 under the `parcel*10000 + row*100 + idx` encoding, so the route's row
 * filter accepts them.
 */
function device(_itemIds: string[], status = 'active') {
  return {
    status,
    assignedSiteId: 'site-1',
    assignedParcel: 0,
    assignedRow: 0,
    assignedSeq: 1,
  }
}
const mockReservations = vi.mocked(prisma.reservation.findMany)

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** The opaque needle held in config; firmware sends it inside a fuller UA string. */
const UA_NEEDLE = 'k3n8fq2p'
const DEVICE_UA = `Sunbnb-Sensor/1 (${UA_NEEDLE})`
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
    headers: { 'user-agent': DEVICE_UA, ...headers },
  })
}

function makeParams(code = CODE) {
  return { params: { code } }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.HW_CLIENT_UA = UA_NEEDLE
  mockDevice.mockResolvedValue(device([SEAT_A, SEAT_B]) as never)
  mockItems.mockResolvedValue([seat(SEAT_A, 12), seat(SEAT_B, 13)] as never)
  mockReservations.mockResolvedValue([] as never)
})

// ── The soft client filter (Q9) ───────────────────────────────────────────────

describe('client filter', () => {
  it('declines a request with no User-Agent at all', async () => {
    const req = new NextRequest(`http://localhost:3002/api/hw/${CODE}/state`, {
      headers: { 'user-agent': '' },
    })
    const res = await GET(req, makeParams())
    expect(res.status).toBe(401)
  })

  it('declines generic scanner traffic (curl / a browser UA)', async () => {
    for (const ua of [
      'curl/8.4.0',
      'python-requests/2.31.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    ]) {
      const res = await GET(makeRequest(CODE, { 'user-agent': ua }), makeParams())
      expect(res.status).toBe(401)
    }
  })

  it('CONTAINS-matches, so a firmware version bump still passes', async () => {
    // The whole point of matching the needle rather than the full UA: /1 → /2 must
    // not require a server config change on a potted fleet.
    const res = await GET(
      makeRequest(CODE, { 'user-agent': `Sunbnb-Sensor/2 (${UA_NEEDLE})` }),
      makeParams(),
    )
    expect(res.status).toBe(200)
  })

  it('an unknown code is declined identically to a failed filter', async () => {
    mockDevice.mockResolvedValueOnce(null as never)
    const unknown = await GET(makeRequest('ZZZZZZ'), makeParams('ZZZZZZ'))
    const filtered = await GET(makeRequest(CODE, { 'user-agent': 'curl/8.4.0' }), makeParams())

    expect(unknown.status).toBe(401)
    expect(filtered.status).toBe(401)
    // A uniform, opaque reject — the caller learns nothing from the difference.
    expect(await unknown.json()).toEqual(await filtered.json())
  })

  it('does no state query for an unknown code', async () => {
    // The binding lookup still runs (that is how the code is resolved), but the
    // expensive seat/reservation reads must not.
    mockDevice.mockResolvedValue(null as never)
    await GET(makeRequest('ZZZZZZ'), makeParams('ZZZZZZ'))
    expect(mockItems).not.toHaveBeenCalled()
    expect(mockReservations).not.toHaveBeenCalled()
  })

  it('touches the database NOT AT ALL for filtered-out traffic', async () => {
    // The filter's real job at ~1.3M polls/day: junk costs a string compare and
    // never a Postgres round-trip — not even the binding lookup.
    await GET(makeRequest(CODE, { 'user-agent': 'curl/8.4.0' }), makeParams())
    expect(mockDevice).not.toHaveBeenCalled()
    expect(mockItems).not.toHaveBeenCalled()
  })

  it('fails CLOSED with 503 when HW_CLIENT_UA is unset (never 200, never FREE)', async () => {
    delete process.env.HW_CLIENT_UA
    const res = await GET(makeRequest(), makeParams())
    expect(res.status).toBe(503)
  })
})

// ── Binding ───────────────────────────────────────────────────────────────────

describe('binding', () => {
  it('401s when no device row carries the code', async () => {
    mockDevice.mockResolvedValue(null as never)
    const res = await GET(makeRequest(), makeParams())
    expect(res.status).toBe(401)
  })

  it('401s for a RETIRED device — a decommissioned unit serves nothing', async () => {
    mockDevice.mockResolvedValue(device([SEAT_A, SEAT_B], 'retired') as never)
    const res = await GET(makeRequest(), makeParams())
    expect(res.status).toBe(401)
  })

  it('SERVES a provisioned-but-not-yet-active device (bring-up must not be trapped)', async () => {
    mockDevice.mockResolvedValue(device([SEAT_A, SEAT_B], 'provisioned') as never)
    const res = await GET(makeRequest(), makeParams())
    expect(res.status).toBe(200)
  })

  it('401s when the device has no location assigned yet', async () => {
    // A self-registered but unassigned device speaks for no spot. An empty
    // aggregate would render FREE — the one answer that must never be invented.
    mockDevice.mockResolvedValue({
      status: 'active',
      assignedSiteId: null,
      assignedParcel: null,
      assignedRow: null,
      assignedSeq: null,
    } as never)
    const res = await GET(makeRequest(), makeParams())
    expect(res.status).toBe(401)
  })

  it('401s when only PART of the location is set — a partial address is not one', async () => {
    mockDevice.mockResolvedValue({
      status: 'active',
      assignedSiteId: 'site-1',
      assignedParcel: 1,
      assignedRow: null,
      assignedSeq: 1,
    } as never)
    expect((await GET(makeRequest(), makeParams())).status).toBe(401)
  })

  it('503s (amber) when the binding lookup itself fails', async () => {
    mockDevice.mockRejectedValue(new Error('db down') as never)
    const res = await GET(makeRequest(), makeParams())
    expect(res.status).toBe(503)
  })

  it('looks the device up by the NORMALISED code', async () => {
    await GET(makeRequest('7qk3m2'), makeParams('7qk3m2'))
    expect(mockDevice).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: CODE } }),
    )
  })

  it('resolves the unit AT THE ASSIGNED LOCATION, excluding pool spares', async () => {
    await GET(makeRequest(), makeParams())
    // Track 021 P5: seats come from the location, not a stored list — and a
    // spare parked at a unit is not a bed under that parasol, so it must never
    // claim a segment on the bar.
    expect(mockItems).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          siteId: 'site-1',
          group: 0,
          sunbedGroup: { seq: 1 },
          status: { not: 'pool' },
        }),
        orderBy: { number: 'asc' },
      }),
    )
  })

  it('ignores seats from ANOTHER ROW that share the unit ordinal', async () => {
    // `seq` is scoped to (parcel,row), so the same ordinal recurs in every row.
    // Row 1's seats (numbers 112/113) must not leak into row 0's device.
    mockItems.mockResolvedValue([
      seat(SEAT_A, 12), seat(SEAT_B, 13),
      seat('clxseat0000000000000000009', 112),
    ] as never)
    const body = await (await GET(makeRequest(), makeParams())).json()
    expect(body.seats.map((s: { id: string }) => s.id)).toEqual([SEAT_A, SEAT_B])
  })

  it('503s (amber) when the assigned location holds NO unit', async () => {
    // The parcel shrank, or the spot was dismounted. A device standing at an
    // address that no longer exists must show amber, never a confident FREE for
    // a bed that is not there.
    mockItems.mockResolvedValue([] as never)
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

  it('emits seats in SEAT order within the unit (segment order)', async () => {
    // Q2 remains open: a device mounted rotated relative to the numbering needs
    // an explicit reverse flag, or it lights the wrong half of the bar.
    mockItems.mockResolvedValue([seat(SEAT_A, 12), seat(SEAT_B, 13)] as never)
    const body = await (await GET(makeRequest(), makeParams())).json()
    expect(body.seats.map((s: { id: string }) => s.id)).toEqual([SEAT_A, SEAT_B])
  })

  describe('one-shot commands', () => {
    const withCmd = (cmd: string | null, agoMs = 0) => ({
      status: 'active',
      assignedSiteId: 'site-1', assignedParcel: 0, assignedRow: 0, assignedSeq: 1,
      pendingCmd: cmd,
      pendingCmdAt: cmd ? new Date(Date.now() - agoMs) : null,
    })

    it('delivers a fresh identify command', async () => {
      mockDevice.mockResolvedValue(withCmd('identify') as never)
      expect((await (await GET(makeRequest(), makeParams())).json()).cmd).toBe('identify')
    })

    it('DROPS a command older than its TTL — there is no ack channel', async () => {
      // A device asleep when "identify" was pressed must not flash an hour later
      // at whoever happens to be standing there then.
      mockDevice.mockResolvedValue(withCmd('identify', 10 * 60 * 1000) as never)
      expect((await (await GET(makeRequest(), makeParams())).json()).cmd).toBeNull()
    })

    it('emits null when nothing is pending', async () => {
      mockDevice.mockResolvedValue(withCmd(null) as never)
      expect((await (await GET(makeRequest(), makeParams())).json()).cmd).toBeNull()
    })

    it('a pending command changes the ETag, so it actually reaches the device', async () => {
      mockDevice.mockResolvedValue(withCmd(null) as never)
      const quiet = (await GET(makeRequest(), makeParams())).headers.get('etag')
      mockDevice.mockResolvedValue(withCmd('identify') as never)
      const commanded = (await GET(makeRequest(), makeParams())).headers.get('etag')
      expect(commanded).not.toBe(quiet)
    })
  })

  it('declares the assigned location back to the device (config on the poll)', async () => {
    const body = await (await GET(makeRequest(), makeParams())).json()
    expect(body.location).toBe('0-0-1')
  })

  it('normalises a Crockford-ambiguous, lowercase code before the lookup', async () => {
    // Stored form is the normalised one: '7qk3il' → uppercase → I and L fold to 1.
    const res = await GET(makeRequest('7qk3il'), makeParams('7qk3il'))
    expect(res.status).toBe(200)
    expect((await res.json()).code).toBe('7QK311')
    expect(mockDevice).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: '7QK311' } }),
    )
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
