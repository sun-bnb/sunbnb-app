/**
 * Device Wi-Fi provisioning — the rules for an SSID/password pair the server
 * hands a device so it can be moved to another access point without a console
 * (`../sunbnb-hw/docs/app-requests/2026-09-26-wifi-health-and-provisioning.md`,
 * part A; track 019 §Wire contract).
 *
 * PURE — no prisma, no env. A client component may import it, and both writers
 * (the admin preferences form and any script) share one rulebook, exactly as
 * `device-power` is shared by the admin and per-device policy writers.
 *
 * ⚠ THE PAIR TRAVELS ON A CREDENTIAL-FREE ENDPOINT. Track 019 Q9 made
 * `/api/hw/{code}/state` deliberately unauthenticated — the only gate is a
 * fleet-wide `User-Agent` needle that "is not secret and cannot be", and device
 * codes are public, printed on the sticker. **While the pair is being served,
 * anyone who knows a device code can read the password.**
 *
 * That is why it is a BROADCAST and not a standing field. The HW spec offered
 * three answers (accept it with a policy · send it only on an explicit operator
 * action · encrypt per device, which reverses Q9); the founder chose the middle
 * one on 2026-09-26. The consequences are the whole design of this module:
 *
 *   - Credentials are stored but NOT served. Saving them changes nothing on the
 *     wire — an operator can stage a network days before switching to it.
 *   - An explicit, confirmed operator action opens a WINDOW
 *     (`WIFI_BROADCAST_WINDOW_MS`). Only inside it does the state response carry
 *     the pair.
 *   - Inside the window each device is served EXACTLY ONCE — the first poll it
 *     makes. `Device.wifiSentAt` records that, and a new broadcast re-arms the
 *     whole fleet because the comparison is against the broadcast's start.
 *   - The window closes on its own. There is no ack channel on this wire (same
 *     reasoning as `pendingCmd`), so a broadcast nobody stops must not leave a
 *     password reachable for the rest of the season.
 *
 * Exposure is therefore a bounded window rather than every reply forever, and
 * the policy still stands on top of it: give the devices their own isolated
 * SSID, so the password protects nothing but the devices' own network. Do not
 * put a venue's main Wi-Fi here. That warning is repeated where an operator
 * actually meets it — the `device-wifi-password` description in `./preferences`.
 *
 * ## Why validation is strict rather than forgiving
 *
 * The consumer is potted on a beach and obeys what it is given all season. The
 * firmware's own protection is that it **never forgets the network it is
 * currently reaching the server through** — a typo cannot strand a unit,
 * because the only path to correct a typo is the network the device is already
 * on. That safety net is the reason a rejection here costs nothing and a
 * silently-mangled value costs a site visit, so every rule below refuses rather
 * than repairs.
 */

/** WPA2: an SSID is at most 32 BYTES — not characters. A 3-byte emoji costs 3. */
export const SSID_MAX_BYTES = 32
/** WPA2 passphrase length. An open network is the empty string instead. */
export const PSK_MIN_LENGTH = 8
export const PSK_MAX_LENGTH = 63

export interface WifiNetwork {
  ssid: string
  /** Empty string = an open network. Never null: the device wants both fields. */
  password: string
}

/** SSID length in UTF-8 bytes, which is the limit WPA2 actually imposes. */
export function ssidByteLength(ssid: string): number {
  return new TextEncoder().encode(ssid).length
}

/**
 * Control characters would not survive the trip — they break the JSON body on
 * the way out and the device's NVS string on the way in. Rejected in both
 * fields rather than stripped, per the refuse-don't-repair rule above.
 */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * Leading or trailing whitespace is REFUSED, and this is not fussiness.
 * Preference values round-trip through `parsePreferenceValue`, which trims
 * every string it reads — so a password stored with a trailing space would be
 * served without it, and the fleet would fail to join a network whose password
 * looks correct in the admin form. Refusing at the door is the only way the
 * value an operator types is the value a device receives.
 */
const EDGE_WHITESPACE_RE = /^\s|\s$/

/**
 * Validate a candidate pair on the WRITE path — it explains itself, because an
 * operator needs to know why their network was refused.
 *
 * An EMPTY SSID with an empty password is accepted as "no network configured"
 * and is how the pair is cleared; the serving path then omits both fields.
 */
export function validateWifiNetwork(
  rawSsid: string,
  rawPassword: string,
): { ok: true; network: WifiNetwork | null } | { ok: false; error: string } {
  const ssid = rawSsid ?? ''
  const password = rawPassword ?? ''

  // Nothing configured. Explicitly not an error: it is the cleared state.
  if (ssid === '' && password === '') return { ok: true, network: null }

  if (ssid === '') {
    return {
      ok: false,
      error: 'A Wi-Fi password needs an SSID. Set both, or clear both to remove the network.',
    }
  }
  if (EDGE_WHITESPACE_RE.test(ssid)) {
    return { ok: false, error: 'The SSID must not start or end with a space.' }
  }
  if (hasControlChar(ssid)) {
    return { ok: false, error: 'The SSID must not contain control characters.' }
  }
  const bytes = ssidByteLength(ssid)
  if (bytes > SSID_MAX_BYTES) {
    return {
      ok: false,
      error: `The SSID is ${bytes} bytes; Wi-Fi allows at most ${SSID_MAX_BYTES}.`,
    }
  }

  if (password !== '') {
    if (EDGE_WHITESPACE_RE.test(password)) {
      return { ok: false, error: 'The password must not start or end with a space.' }
    }
    if (hasControlChar(password)) {
      return { ok: false, error: 'The password must not contain control characters.' }
    }
    if (password.length < PSK_MIN_LENGTH || password.length > PSK_MAX_LENGTH) {
      return {
        ok: false,
        error: `The password must be ${PSK_MIN_LENGTH}–${PSK_MAX_LENGTH} characters, or empty for an open network.`,
      }
    }
  }

  return { ok: true, network: { ssid, password } }
}

/**
 * The READ path's version: a pair to serve, or null. Silent — this runs while
 * answering a device poll, where there is nobody to explain a refusal to and a
 * bad stored value must degrade to "no network offered" rather than to a 500.
 *
 * The second check, deliberately. The admin writer already refuses everything
 * this catches, but a row can arrive by direct SQL, by an env override, or from
 * an older release — the same reason `device-power` clamps the poll interval on
 * the serving path. Serving half a pair would be worse than serving none: the
 * device ignores a lone field, so it would look configured and do nothing.
 */
export function resolveWifiNetwork(
  ssid: string | null | undefined,
  password: string | null | undefined,
): WifiNetwork | null {
  const result = validateWifiNetwork(ssid ?? '', password ?? '')
  return result.ok ? result.network : null
}

// ─── Broadcast window ───────────────────────────────────────────────────────

/**
 * How long a started broadcast stays open. Every device that polls inside the
 * window gets the pair once; when it closes, the response stops carrying
 * credentials whether or not every unit was reached.
 *
 * Thirty minutes is sized against the SLOWEST cadence the fleet can be set to —
 * deep sleep tops out at a 300 s poll interval (`./device-power`), so this is
 * six poll cycles even for the laziest configuration, with room for a unit that
 * was briefly out of range. It is deliberately not "until an operator stops it":
 * this wire has no acknowledgement channel, so a broadcast that is forgotten is
 * the normal case, and a forgotten broadcast must expire rather than leave a
 * password readable to anyone holding a device code.
 *
 * A device missed by the window is not stranded — the firmware never forgets
 * the network it is currently reaching us through. Start another broadcast.
 */
export const WIFI_BROADCAST_WINDOW_MS = 30 * 60 * 1000

/** Is a broadcast started at `startedAt` still open at `now`? */
export function isBroadcastOpen(startedAt: Date | null, now: Date = new Date()): boolean {
  if (!startedAt) return false
  const elapsed = now.getTime() - startedAt.getTime()
  // A start stamp in the FUTURE is rejected rather than trusted: it would
  // otherwise hold the window open for as long as the clock skew lasts, and
  // this value can arrive from a hand-edited row or an env override.
  if (elapsed < 0) return false
  return elapsed < WIFI_BROADCAST_WINDOW_MS
}

/** Milliseconds left in the window, clamped at 0. For the admin countdown. */
export function broadcastRemainingMs(startedAt: Date | null, now: Date = new Date()): number {
  if (!startedAt || !isBroadcastOpen(startedAt, now)) return 0
  return WIFI_BROADCAST_WINDOW_MS - (now.getTime() - startedAt.getTime())
}

/**
 * Should THIS device be served the pair on THIS poll?
 *
 * Exactly once per device per broadcast: served when the broadcast is open and
 * the device has not been served since it STARTED. Comparing against the start
 * — rather than storing a "sent" boolean — is what makes a new broadcast re-arm
 * the whole fleet without touching a single device row, and what makes a
 * mistyped password recoverable: fix it, broadcast again, everyone gets the new
 * one.
 *
 * `>=` on purpose. Two polls landing in the same millisecond as the start stamp
 * should not both be served; the cost of the strict reading is a device that
 * waits for the next broadcast, which is recoverable, against a duplicate send,
 * which is the exposure this design exists to bound.
 */
export function shouldSendWifi(
  startedAt: Date | null,
  deviceSentAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!startedAt || !isBroadcastOpen(startedAt, now)) return false
  if (!deviceSentAt) return true
  return deviceSentAt.getTime() < startedAt.getTime()
}

/**
 * Parse the stored broadcast stamp. Returns null for anything unparseable, so
 * a corrupt row reads as "no broadcast" — the safe direction, since the failure
 * mode of the other one is a password on an open endpoint.
 */
export function parseBroadcastStartedAt(raw: string | null | undefined): Date | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const at = new Date(trimmed)
  return Number.isNaN(at.getTime()) ? null : at
}
