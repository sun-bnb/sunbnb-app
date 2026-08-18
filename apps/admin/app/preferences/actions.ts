'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import {
  getPreferenceAdminRows,
  setPreference,
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
