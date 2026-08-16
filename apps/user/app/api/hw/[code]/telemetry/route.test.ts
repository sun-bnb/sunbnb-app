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

import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

import { POST } from './route'

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
  process.env.HW_CLIENT_UA = UA_NEEDLE
  process.env.HW_DEVICE_MAP = JSON.stringify({ [CODE]: [SEAT_A, SEAT_B] })
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

  it('an unknown code is declined identically to a failed filter', async () => {
    const unknown = await POST(makeRequest('ZZZZZZ'), makeParams('ZZZZZZ'))
    const filtered = await POST(
      makeRequest(CODE, { headers: { 'user-agent': 'curl/8.4.0' } }),
      makeParams(),
    )

    expect(unknown.status).toBe(401)
    expect(filtered.status).toBe(401)
    // A uniform, opaque reject — the caller learns nothing from the difference.
    expect(await unknown.json()).toEqual(await filtered.json())
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

  it('persists nothing — an unknown field in the payload is accepted, not rejected', async () => {
    const res = await POST(
      makeRequest(CODE, { body: JSON.stringify({ ...BODY, somethingNew: true }) }),
      makeParams(),
    )
    expect(res.status).toBe(204)
  })

  it('normalises the code before binding lookup (lowercase/Crockford resolves)', async () => {
    // Map is keyed by the canonical CODE; a device sending it lowercased must still
    // resolve, mirroring the state route’s normalisation.
    const res = await POST(makeRequest('7qk3m2'), makeParams('7qk3m2'))
    expect(res.status).toBe(204)
  })
})
