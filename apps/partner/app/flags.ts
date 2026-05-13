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

export async function getFlags(): Promise<FlagStates> {
  return getFlagStates({ isSudo: await isSudoUser() })
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
