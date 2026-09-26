import { describe, it, expect } from 'vitest'
import {
  PSK_MAX_LENGTH,
  PSK_MIN_LENGTH,
  SSID_MAX_BYTES,
  WIFI_BROADCAST_WINDOW_MS,
  broadcastRemainingMs,
  isBroadcastOpen,
  parseBroadcastStartedAt,
  resolveWifiNetwork,
  shouldSendWifi,
  ssidByteLength,
  validateWifiNetwork,
} from './device-wifi'

// These tests are written against the two things that cost real money if they
// are wrong: a credential that reaches a device MANGLED (a site visit, because
// nobody can log into a potted unit), and a credential that stays readable on
// an unauthenticated endpoint LONGER than the operator believes.

describe('validateWifiNetwork', () => {
  it('accepts a normal WPA2 pair', () => {
    const result = validateWifiNetwork('Venue-Devices', 'correct-horse')
    expect(result).toEqual({ ok: true, network: { ssid: 'Venue-Devices', password: 'correct-horse' } })
  })

  it('treats both-empty as the cleared state, not an error', () => {
    expect(validateWifiNetwork('', '')).toEqual({ ok: true, network: null })
  })

  it('accepts an empty password as an open network', () => {
    const result = validateWifiNetwork('Venue-Open', '')
    expect(result.ok && result.network).toEqual({ ssid: 'Venue-Open', password: '' })
  })

  it('refuses a password with no SSID — the device ignores a lone field', () => {
    const result = validateWifiNetwork('', 'correct-horse')
    expect(result.ok).toBe(false)
  })

  it.each([
    ['too short', 'a'.repeat(PSK_MIN_LENGTH - 1)],
    ['too long', 'a'.repeat(PSK_MAX_LENGTH + 1)],
  ])('refuses a password that is %s', (_label, password) => {
    expect(validateWifiNetwork('Venue', password).ok).toBe(false)
  })

  it.each([PSK_MIN_LENGTH, PSK_MAX_LENGTH])('accepts a password of exactly %i characters', (len) => {
    expect(validateWifiNetwork('Venue', 'a'.repeat(len)).ok).toBe(true)
  })

  it('measures the SSID in BYTES, not characters', () => {
    // A character-based check would store an SSID no access point can
    // represent: 9 beach emoji are 18 UTF-16 code units but 36 UTF-8 bytes.
    const emoji = '\u{1F3D6}'.repeat(9)
    expect(emoji.length).toBeLessThan(SSID_MAX_BYTES)
    expect(ssidByteLength(emoji)).toBeGreaterThan(SSID_MAX_BYTES)
    expect(validateWifiNetwork(emoji, 'correct-horse').ok).toBe(false)
  })

  it('accepts an SSID of exactly the byte limit', () => {
    expect(validateWifiNetwork('a'.repeat(SSID_MAX_BYTES), '').ok).toBe(true)
  })

  it.each([
    ['leading', ' Venue'],
    ['trailing', 'Venue '],
  ])('refuses an SSID with %s whitespace', (_label, ssid) => {
    // Preference values round-trip through a trimming reader, so a stored edge
    // space would be silently dropped and the device would be handed a
    // different network than the one on screen.
    expect(validateWifiNetwork(ssid, '').ok).toBe(false)
  })

  it.each([
    ['leading', ' hunter2hunter2'],
    ['trailing', 'hunter2hunter2 '],
  ])('refuses a password with %s whitespace', (_label, password) => {
    expect(validateWifiNetwork('Venue', password).ok).toBe(false)
  })

  it('refuses control characters, which would not survive JSON or NVS', () => {
    expect(validateWifiNetwork('Ven\nue', '').ok).toBe(false)
    expect(validateWifiNetwork('Venue', 'hunter2\u0000hunter').ok).toBe(false)
  })
})

describe('resolveWifiNetwork', () => {
  it('returns null rather than throwing for a corrupt stored pair', () => {
    expect(resolveWifiNetwork('Venue', 'short')).toBeNull()
    expect(resolveWifiNetwork(null, null)).toBeNull()
    expect(resolveWifiNetwork(undefined, undefined)).toBeNull()
  })

  it('never returns half a pair', () => {
    // Serving a lone field is worse than serving none: the device ignores it,
    // so the fleet looks provisioned and nothing happens.
    expect(resolveWifiNetwork('', 'correct-horse')).toBeNull()
  })
})

describe('isBroadcastOpen', () => {
  const start = new Date('2026-09-26T10:00:00.000Z')

  it('is closed when no broadcast was ever started', () => {
    expect(isBroadcastOpen(null, start)).toBe(false)
  })

  it('is open at the moment it starts and just before the window ends', () => {
    expect(isBroadcastOpen(start, start)).toBe(true)
    expect(isBroadcastOpen(start, new Date(start.getTime() + WIFI_BROADCAST_WINDOW_MS - 1))).toBe(true)
  })

  it('closes exactly at the window, not a moment later', () => {
    expect(isBroadcastOpen(start, new Date(start.getTime() + WIFI_BROADCAST_WINDOW_MS))).toBe(false)
  })

  it('rejects a start stamp in the future instead of trusting it', () => {
    // A hand-edited row or a clock skew must not hold the window open: the
    // failure mode is a password readable on an open endpoint.
    const future = new Date(start.getTime() + 60_000)
    expect(isBroadcastOpen(future, start)).toBe(false)
  })

  it('stays closed long after the window', () => {
    expect(isBroadcastOpen(start, new Date(start.getTime() + 86_400_000))).toBe(false)
  })
})

describe('broadcastRemainingMs', () => {
  const start = new Date('2026-09-26T10:00:00.000Z')

  it('counts down and never goes negative', () => {
    expect(broadcastRemainingMs(start, start)).toBe(WIFI_BROADCAST_WINDOW_MS)
    expect(broadcastRemainingMs(start, new Date(start.getTime() + 60_000))).toBe(
      WIFI_BROADCAST_WINDOW_MS - 60_000,
    )
    expect(broadcastRemainingMs(start, new Date(start.getTime() + 86_400_000))).toBe(0)
    expect(broadcastRemainingMs(null, start)).toBe(0)
  })
})

describe('shouldSendWifi', () => {
  const start = new Date('2026-09-26T10:00:00.000Z')
  const during = new Date(start.getTime() + 60_000)

  it('serves a device that has never been served', () => {
    expect(shouldSendWifi(start, null, during)).toBe(true)
  })

  it('serves a device exactly once per broadcast', () => {
    expect(shouldSendWifi(start, null, during)).toBe(true)
    // …and once it has been marked, not again inside the same window.
    expect(shouldSendWifi(start, during, new Date(start.getTime() + 120_000))).toBe(false)
  })

  it('re-arms every device when a NEW broadcast starts', () => {
    // This is how a mistyped password is corrected: fix it, broadcast again,
    // and units that already took the wrong one are served the new one.
    const servedInFirst = new Date(start.getTime() + 60_000)
    const secondStart = new Date(start.getTime() + 3_600_000)
    expect(shouldSendWifi(secondStart, servedInFirst, new Date(secondStart.getTime() + 1_000))).toBe(
      true,
    )
  })

  it('does not serve a device already served within THIS broadcast', () => {
    const sameInstant = new Date(start.getTime())
    expect(shouldSendWifi(start, sameInstant, during)).toBe(false)
  })

  it('serves nothing once the window has closed, however new the device is', () => {
    const after = new Date(start.getTime() + WIFI_BROADCAST_WINDOW_MS + 1)
    expect(shouldSendWifi(start, null, after)).toBe(false)
  })

  it('serves nothing when no broadcast is running', () => {
    expect(shouldSendWifi(null, null, during)).toBe(false)
  })
})

describe('parseBroadcastStartedAt', () => {
  it('reads an ISO stamp back', () => {
    const at = parseBroadcastStartedAt('2026-09-26T10:00:00.000Z')
    expect(at?.toISOString()).toBe('2026-09-26T10:00:00.000Z')
  })

  it.each([['', 'empty'], ['   ', 'blank'], ['not-a-date', 'garbage']])(
    'reads %s (%s) as no broadcast',
    (raw) => {
      expect(parseBroadcastStartedAt(raw)).toBeNull()
    },
  )

  it('reads null/undefined as no broadcast', () => {
    // The safe direction: the other failure mode is a password left reachable.
    expect(parseBroadcastStartedAt(null)).toBeNull()
    expect(parseBroadcastStartedAt(undefined)).toBeNull()
  })
})
