'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import {
  getPreferenceAdminRows,
  setPreference,
  setDevicePolicy,
  resetDevicePolicy as resetDevicePolicyOverrides,
  isPreferenceKey,
  setDeviceWifiNetwork,
  getDeviceWifiNetwork,
  getDeviceWifiBroadcast,
  startDeviceWifiBroadcast,
  stopDeviceWifiBroadcast,
  type PreferenceAdminRow,
} from '@repo/data/preferences'
import {
  isBroadcastOpen,
  broadcastRemainingMs,
  WIFI_BROADCAST_WINDOW_MS,
} from '@repo/data/device-wifi'

async function requireSudo() {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sudo: true },
  })
  if (!user?.sudo) throw new Error('Unauthorized — sudo required')
  return session
}

export async function listPreferences(): Promise<PreferenceAdminRow[]> {
  await requireSudo()
  return getPreferenceAdminRows()
}

/**
 * Store an override. `value` arrives as the raw string the admin typed —
 * validation (type, bounds) belongs to the registry in `@repo/data/preferences`,
 * not to this form, so the same rules apply to a script or a future API.
 */
export async function savePreference(key: string, value: string) {
  const session = await requireSudo()
  if (!isPreferenceKey(key)) {
    return { status: 'error' as const, errors: [`Unknown preference: ${key}`] }
  }
  const result = await setPreference(key, value, session.user.id)
  if (result.status === 'ok') revalidatePath('/preferences')
  return result
}

/** Remove the override, so the preference falls back to env var / registry default. */
export async function resetPreference(key: string) {
  await requireSudo()
  if (!isPreferenceKey(key)) {
    return { status: 'error' as const, errors: [`Unknown preference: ${key}`] }
  }
  const result = await setPreference(key, null)
  if (result.status === 'ok') revalidatePath('/preferences')
  return result
}

/**
 * Save the device power policy as one unit — the mode, and the cadence that has to
 * fit inside it.
 *
 * Separate from `savePreference` because the two keys are coupled: each mode keeps
 * only its own band of poll intervals, so a mode change and the interval beneath it
 * have to be judged together. Saving them one at a time is what forces the server
 * to either refuse the second write or silently re-fit it, and neither is what the
 * admin asked for. Validation itself stays in `@repo/data/preferences` — this
 * action has no opinion about the bands.
 */
export async function saveDevicePolicy(mode: string, intervalSec: string) {
  const session = await requireSudo()
  const result = await setDevicePolicy(mode, intervalSec, session.user.id)
  if (result.status === 'ok') revalidatePath('/preferences')
  return result
}

/** Drop both device-policy overrides, so the pair falls back to env/default. */
export async function resetDevicePolicy() {
  await requireSudo()
  const result = await resetDevicePolicyOverrides()
  revalidatePath('/preferences')
  return result
}

// ─── Device Wi-Fi: credentials, and the broadcast that delivers them ────────
//
// Two operations, never one. SAVING the pair changes nothing on the wire, so a
// network can be staged in advance; BROADCASTING opens the bounded window in
// which each device is served the credentials exactly once. They are separate
// because the poll endpoint has no authentication (track 019 Q9) and device
// codes are public — an operator must be able to edit a password without
// putting it on an open endpoint, and must not be able to expose it by
// accident. The confirmation step lives in the form; the window and the
// once-per-device rule live in `@repo/data/device-wifi`.

export interface WifiBroadcastStatus {
  ssid: string
  /** Whether a password is stored. The value itself never leaves the server. */
  passwordSet: boolean
  /** True when a complete, valid pair is stored and could be broadcast. */
  ready: boolean
  startedAt: string | null
  open: boolean
  remainingMs: number
  windowMs: number
  /** Devices served since this broadcast started, and the fleet it is aimed at. */
  reached: number
  total: number
}

export async function getWifiBroadcastStatus(): Promise<WifiBroadcastStatus> {
  await requireSudo()
  const [network, broadcast] = await Promise.all([
    getDeviceWifiNetwork(),
    getDeviceWifiBroadcast(),
  ])
  const startedAt = broadcast.startedAt
  const open = isBroadcastOpen(startedAt)

  // Counted against the broadcast's START, the same comparison the serving path
  // makes — so this number is what actually happened, not a tally kept
  // alongside it that could drift.
  const [reached, total] = await Promise.all([
    startedAt
      ? prisma.device.count({
          where: { status: { not: 'retired' }, wifiSentAt: { gte: startedAt } },
        })
      : Promise.resolve(0),
    prisma.device.count({ where: { status: { not: 'retired' } } }),
  ])

  return {
    ssid: network?.ssid ?? '',
    passwordSet: (network?.password ?? '') !== '',
    ready: network !== null,
    startedAt: startedAt ? startedAt.toISOString() : null,
    open,
    remainingMs: broadcastRemainingMs(startedAt),
    windowMs: WIFI_BROADCAST_WINDOW_MS,
    reached,
    total,
  }
}

/**
 * Store the pair. Deliberately does NOT broadcast it.
 *
 * `password === null` keeps whatever is stored — the form never gets the
 * password back, so a blank field there means "unchanged", not "clear it".
 * An open network is an explicit empty string.
 */
export async function saveDeviceWifi(ssid: string, password: string | null) {
  const session = await requireSudo()
  const result = await setDeviceWifiNetwork(ssid, password, session.user.id)
  if (result.status === 'ok') revalidatePath('/preferences')
  return result
}

/**
 * Open the window. The form confirms before calling this — it is the moment a
 * Wi-Fi password becomes readable to anyone holding a device code.
 */
export async function startWifiBroadcast() {
  const session = await requireSudo()
  const result = await startDeviceWifiBroadcast(session.user.id)
  if (result.status === 'ok') revalidatePath('/preferences')
  return result.status === 'ok'
    ? { status: 'ok' as const, startedAt: result.startedAt.toISOString() }
    : result
}

/** Close the window early, before it expires on its own. */
export async function stopWifiBroadcast() {
  const session = await requireSudo()
  const result = await stopDeviceWifiBroadcast(session.user.id)
  revalidatePath('/preferences')
  return result
}
