'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'


export async function getTokens() {

  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  return await prisma.securityToken.findMany({
    where: { 
      userId: session.user.id
    }
  })
}

export async function createToken(expires: Date, resources: string[]) {

  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  // Input validation
  if (!expires || isNaN(new Date(expires).getTime())) {
    return { status: 'error', errors: ['Invalid expiry date'] }
  }
  if (new Date(expires) < new Date()) {
    return { status: 'error', errors: ['Expiry date must be in the future'] }
  }
  if (!Array.isArray(resources) || resources.length > 50) {
    return { status: 'error', errors: ['Too many resources (max 50)'] }
  }
  if (resources.some(r => typeof r !== 'string' || r.length > 200)) {
    return { status: 'error', errors: ['Each resource must be a string of max 200 characters'] }
  }

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