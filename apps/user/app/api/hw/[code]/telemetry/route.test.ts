/**
 * Tests for POST /api/hw/[code]/telemetry — the device telemetry stub (track 019 P1.5).
 *
 * The stub persists nothing, so there is no data to assert. What the contract
 * (`.claude/tracks/019-hw-api.md`) does pin, and what these tests lock down, is the
 * WIRE BEHAVIOUR the firmware depends on:
 *
 *   - **The soft client filter** (Q9) — a real sensor UA passes, generic scanner
 *     traffic (curl, browser, empty UA) is declined pre-DB, and an unset config
 *     fails CLOSED rather than opening the endpoint.
 *   - **A 204 that never depends on the body** — a malformed or absent payload is
 *     still accepted, because telemetry must never fail the device's loop.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

import { POST } from './route'
import prisma from '@repo/data/PrismaCient'

const mockDevice = vi.mocked(prisma.device.findUnique)

/** A bound device row in the shape hw-filter selects: seats already in mount order. */
function device(itemIds: string[], status = 'active') {
  return { status, seats: itemIds.map((itemId) => ({ itemId })) }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** The opaque needle held in config; firmware sends it inside a fuller UA string. */
const UA_NEEDLE = 'k3n8fq2p'
const DEVICE_UA = `Sunbnb-Sensor/1 (${UA_NEEDLE})`
const CODE = '7QK3M2'
const SEAT_A = 'clxseat0000000000000000001'
const SEAT_B = 'clxseat0000000000000000002'

const BODY = { fw: '1.2.0', battMv: 4020, rssiDbm: -67, upSec: 86400, polls: 1440, tempC: 31 }

function makeRequest(
  code = CODE,
  opts: { headers?: Record<string, string>; body?: string } = {},
): NextRequest {
  return new NextRequest(`http://localhost:3002/api/hw/${code}/telemetry`, {
    method: 'POST',
    headers: {
      'user-agent': DEVICE_UA,
      'content-type': 'application/json',
      ...opts.headers,
    },
    body: opts.body ?? JSON.stringify(BODY),
  })
}

function makeParams(code = CODE) {
  return { params: { code } }
}

beforeEach(() => {
  // Track 021 P5: the route now WRITES, so call history matters — without this,
  // `mock.calls[0]` belongs to whichever earlier test wrote first. (Clearing
  // wipes history, not implementations, so the device stub below still stands.)
  vi.clearAllMocks()
  process.env.HW_CLIENT_UA = UA_NEEDLE
  mockDevice.mockResolvedValue(device([SEAT_A, SEAT_B]) as never)
  vi.mocked(prisma.device.updateMany).mockResolvedValue({ count: 1 } as never)
})

// ── The soft client filter (Q9) ───────────────────────────────────────────────

describe('client filter', () => {
  it('declines a request with no User-Agent at all', async () => {
    const req = new NextRequest(`http://localhost:3002/api/hw/${CODE}/telemetry`, {
      method: 'POST',
      headers: { 'user-agent': '' },
      body: JSON.stringify(BODY),
    })
    const res = await POST(req, makeParams())
    expect(res.status).toBe(401)
  })

  it('declines generic scanner traffic (curl / a browser UA)', async () => {
    for (const ua of [
      'curl/8.4.0',
      'python-requests/2.31.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    ]) {
      const res = await POST(makeRequest(CODE, { headers: { 'user-agent': ua } }), makeParams())
      expect(res.status).toBe(401)
    }
  })

  it('CONTAINS-matches, so a firmware version bump still passes', async () => {
    // The whole point of matching the needle rather than the full UA: /1 → /2 must
    // not require a server config change on a potted fleet.
    const res = await POST(
      makeRequest(CODE, { headers: { 'user-agent': `Sunbnb-Sensor/2 (${UA_NEEDLE})` } }),
      makeParams(),
    )
    expect(res.status).toBe(204)
  })

  // Track 021 P5: telemetry no longer requires a binding, because an UNASSIGNED
  // device must be able to announce itself or it can never appear in the fleet
  // list to be assigned from. It therefore answers 204 to any request that
  // passes the client filter and simply persists more when it can — which also
  // keeps it from becoming an existence oracle for codes printed on public
  // stickers.
  it('accepts an unknown code with 204 and writes nothing (no existence oracle)', async () => {
    vi.mocked(prisma.device.updateMany).mockResolvedValue({ count: 0 } as never)
    const unknown = await POST(makeRequest('ZZZZZZ'), makeParams('ZZZZZZ'))
    expect(unknown.status).toBe(204)
    // The write is attempted but matches nothing — no row is invented.
    expect(vi.mocked(prisma.device.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: 'ZZZZZZ' } }),
    )
  })

  it('a failed client filter is still declined', async () => {
    const filtered = await POST(
      makeRequest(CODE, { headers: { 'user-agent': 'curl/8.4.0' } }),
      makeParams(),
    )
    expect(filtered.status).toBe(401)
    expect(vi.mocked(prisma.device.updateMany)).not.toHaveBeenCalled()
  })

  it('fails CLOSED with 503 when HW_CLIENT_UA is unset — never opens the endpoint', async () => {
    delete process.env.HW_CLIENT_UA
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(503)
  })
})

// ── Accept: 204, never body-dependent ──────────────────────────────────────────

describe('accept', () => {
  it('204s on a well-formed telemetry payload', async () => {
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(204)
  })

  it('returns an empty body (204 No Content)', async () => {
    const res = await POST(makeRequest(), makeParams())
    expect(await res.text()).toBe('')
  })

  it('204s on a malformed (non-JSON) body — a bad body never fails the loop', async () => {
    const res = await POST(makeRequest(CODE, { body: 'not json at all' }), makeParams())
    expect(res.status).toBe(204)
  })

  it('204s on an empty body', async () => {
    const res = await POST(makeRequest(CODE, { body: '' }), makeParams())
    expect(res.status).toBe(204)
  })

  it('accepts an unknown field in the payload rather than rejecting it', async () => {
    const res = await POST(
      makeRequest(CODE, { body: JSON.stringify({ ...BODY, somethingNew: true }) }),
      makeParams(),
    )
    expect(res.status).toBe(204)
  })

  it('normalises the code before persisting', async () => {
    // Devices are stored under the canonical code; a lowercased one must still
    // resolve, mirroring the state route's normalisation.
    const res = await POST(makeRequest('7qk3m2'), makeParams('7qk3m2'))
    expect(res.status).toBe(204)
    expect(vi.mocked(prisma.device.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: CODE } }),
    )
  })

  // A retired device that is still transmitting is INFORMATION — it means a box
  // nobody expects is still on a pole. Record it; the fleet UI can surface it.
  it('still records a retired device rather than declining it', async () => {
    mockDevice.mockResolvedValue(device([SEAT_A, SEAT_B], 'retired') as never)
    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(204)
    expect(vi.mocked(prisma.device.updateMany)).toHaveBeenCalled()
  })

  describe('last-values persistence', () => {
    it('writes the reported fields and stamps lastSeenAt', async () => {
      const res = await POST(
        makeRequest(CODE, { body: JSON.stringify({ fw: '1.4.2', battMv: 3980, rssiDbm: -67, upSec: 91234, loc: '1-1-1' }) }),
        makeParams(),
      )
      expect(res.status).toBe(204)
      const data = vi.mocked(prisma.device.updateMany).mock.calls[0]![0]!.data as Record<string, unknown>
      expect(data).toMatchObject({
        fw: '1.4.2', battMv: 3980, rssiDbm: -67, upSec: 91234, reportedLocation: '1-1-1',
      })
      expect(data.lastSeenAt).toBeInstanceOf(Date)
    })

    it('OMITS fields the device did not send rather than nulling them', async () => {
      // "We have not heard a battery reading lately" and "the battery is
      // unknown" are different things to an operator — a partial payload (or a
      // firmware that drops a field) must not wipe the last known value.
      await POST(makeRequest(CODE, { body: JSON.stringify({ fw: '1.4.2' }) }), makeParams())
      const data = vi.mocked(prisma.device.updateMany).mock.calls[0]![0]!.data as Record<string, unknown>
      expect(data).toHaveProperty('fw')
      expect(data).not.toHaveProperty('battMv')
      expect(data).not.toHaveProperty('rssiDbm')
      expect(data).not.toHaveProperty('reportedLocation')
    })

    it('accepts and drops polls/tempC — no column is invented for them', async () => {
      await POST(makeRequest(CODE, { body: JSON.stringify({ polls: 42, tempC: 31.5 }) }), makeParams())
      const data = vi.mocked(prisma.device.updateMany).mock.calls[0]![0]!.data as Record<string, unknown>
      expect(data).not.toHaveProperty('polls')
      expect(data).not.toHaveProperty('tempC')
    })

    it('a database failure still answers 204 (telemetry never fails the poll loop)', async () => {
      vi.mocked(prisma.device.updateMany).mockRejectedValueOnce(new Error('db down'))
      const res = await POST(makeRequest(CODE, { body: JSON.stringify({ fw: '1.4.2' }) }), makeParams())
      expect(res.status).toBe(204)
    })
  })
})
