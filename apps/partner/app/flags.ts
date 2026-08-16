import prisma from '@repo/data/PrismaCient'
import {
  getFlagStates,
  type FlagName,
  type FlagStates,
} from '@repo/data/flags'
import type { ClientFlagMap } from '@repo/ui/flags'
import { auth } from './auth'

async function sessionContext(): Promise<{ isSudo: boolean; accountId?: string }> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { isSudo: false }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { sudo: true },
  })
  // Track 021 P5: flags resolve PER CUSTOMER here — one operator can have
  // devices while the rest do not, which a platform-wide switch cannot express.
  return { isSudo: !!user?.sudo, accountId: userId }
}

export async function getFlags(): Promise<FlagStates> {
  return getFlagStates(await sessionContext())
}

export async function isFlagEnabled(name: FlagName): Promise<boolean> {
  return (await getFlags())[name]?.enabled ?? false
}

export async function getClientFlags(): Promise<ClientFlagMap> {
  const states = await getFlags()
  const out: ClientFlagMap = {}
  for (const [name, state] of Object.entries(states)) {
    out[name] = { enabled: state.enabled }
  }
  return out
}
