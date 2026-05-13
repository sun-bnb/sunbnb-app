'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import {
  getFlagAdminRows,
  setFlagOverride,
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
