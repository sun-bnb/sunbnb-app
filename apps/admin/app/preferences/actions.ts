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
  type PreferenceAdminRow,
} from '@repo/data/preferences'

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
