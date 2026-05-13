import prisma from '@repo/data/PrismaCient'
import {
  getFlagStates,
  type FlagName,
  type FlagStates,
} from '@repo/data/flags'
import type { ClientFlagMap } from '@repo/ui/flags'
import { auth } from './auth'

async function isSudoUser(): Promise<boolean> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return false
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { sudo: true },
  })
  return !!user?.sudo
}

/**
 * Server-only: resolve every flag for the current request. The DB call is a
 * single indexed query on a tiny table; if profiling later shows it's hot,
 * wrap in `React.cache` (only works in server-component context).
 */
export async function getFlags(): Promise<FlagStates> {
  return getFlagStates({ isSudo: await isSudoUser() })
}

export async function isFlagEnabled(name: FlagName): Promise<boolean> {
  return (await getFlags())[name]?.enabled ?? false
}

/**
 * Strip server-only metadata before serialising into the client provider.
 */
export async function getClientFlags(): Promise<ClientFlagMap> {
  const states = await getFlags()
  const out: ClientFlagMap = {}
  for (const [name, state] of Object.entries(states)) {
    out[name] = { enabled: state.enabled }
  }
  return out
}
