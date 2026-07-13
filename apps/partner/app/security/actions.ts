'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'


export async function getTokens() {

  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  return await prisma.securityToken.findMany({
    where: {
      userId: session.user.id
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getOwnedSites() {

  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  return await prisma.site.findMany({
    where: { userId: session.user.id },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}

export async function createToken(opts?: { admin?: boolean }) {

  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  // One-year validity from now. The Security page generates tokens with the
  // implicit `all` role and a fixed expiry — the multi-role data model is
  // preserved at the schema level for tokens issued by other means.
  //
  // Admin tokens include `'admin'` in resources, granting access to the
  // admin-gated till summary actions (getOpenTills, getTillDayReport) on the
  // manage page. The `'all'` resource is still present so the admin token also
  // satisfies the standard manage-page gate (hasSome ['all', 'manage_site']).
  const resources = opts?.admin ? ['all', 'admin'] : ['all']

  const expires = new Date()
  expires.setFullYear(expires.getFullYear() + 1)

  const token = await prisma.securityToken.create({
    data: {
      userId: session.user.id,
      resources,
      expires
    }
  })

  return { status: 'ok', token: token.id }

}

export async function deleteToken(id: string) {

  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  await prisma.securityToken.delete({
    where: {
      id,
      userId: session.user.id,
    }
  })

  return { status: 'ok' }
}
