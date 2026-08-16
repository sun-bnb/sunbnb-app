'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import {
  getFlagAdminRows,
  setFlagOverride,
  listAccountFlags,
  setAccountFlag,
  clearAccountFlag,
  type FlagAdminRow,
  type FlagName,
  FLAG_REGISTRY,
} from '@repo/data/flags'

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

function isKnownFlag(name: string): name is FlagName {
  return name in FLAG_REGISTRY
}

export async function listFlags(): Promise<FlagAdminRow[]> {
  await requireSudo()
  return getFlagAdminRows()
}

export async function setFlag(name: string, enabled: boolean) {
  const session = await requireSudo()
  if (!isKnownFlag(name)) {
    return { status: 'error' as const, errors: [`Unknown flag: ${name}`] }
  }
  await setFlagOverride(name, enabled, session.user.id)
  revalidatePath('/flags')
  return { status: 'ok' as const }
}

export async function clearFlag(name: string) {
  await requireSudo()
  if (!isKnownFlag(name)) {
    return { status: 'error' as const, errors: [`Unknown flag: ${name}`] }
  }
  await setFlagOverride(name, null)
  revalidatePath('/flags')
  return { status: 'ok' as const }
}

// ─── Per-customer overrides (track 021 P5) ──────────────────────────────────
//
// Global flags answer "does this feature exist yet"; these answer "does THIS
// operator have it" — the real question for something like devices, where one
// customer has hardware and the rest do not.

export interface AccountFlagRow {
  accountId: string
  name: string
  enabled: boolean
  updatedAt: Date
  updatedBy: string | null
}

/** Find a partner by email or name so an admin can flag them without an id. */
export async function searchPartners(query: string) {
  await requireSudo()
  const term = query.trim()
  if (term.length < 2) return []
  return prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: term, mode: 'insensitive' } },
        { name: { contains: term, mode: 'insensitive' } },
      ],
    },
    select: { id: true, email: true, name: true },
    orderBy: { email: 'asc' },
    take: 10,
  })
}

export async function getAccountFlags(accountId: string): Promise<AccountFlagRow[]> {
  await requireSudo()
  const rows = await listAccountFlags(accountId)
  return rows.map((row) => ({ accountId, ...row }))
}

export async function setFlagForAccount(accountId: string, name: string, enabled: boolean) {
  const session = await requireSudo()
  if (!isKnownFlag(name)) {
    return { status: 'error' as const, errors: [`Unknown flag: ${name}`] }
  }
  if (!accountId) {
    return { status: 'error' as const, errors: ['An account is required'] }
  }
  await setAccountFlag(accountId, name, enabled, session.user.id)
  revalidatePath('/flags')
  return { status: 'ok' as const }
}

/**
 * Remove the per-customer decision entirely, so the account follows the global
 * flag again. Distinct from setting it false: "no opinion" and "off for this
 * customer" resolve alike today but diverge the moment the global default moves.
 */
export async function clearFlagForAccount(accountId: string, name: string) {
  await requireSudo()
  if (!isKnownFlag(name)) {
    return { status: 'error' as const, errors: [`Unknown flag: ${name}`] }
  }
  await clearAccountFlag(accountId, name)
  revalidatePath('/flags')
  return { status: 'ok' as const }
}
