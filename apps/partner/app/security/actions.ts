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

  const token = await prisma.securityToken.create({
    data: {
      userId: session.user.id,
      resources,
      expires
    }
  })

  return { status: 'ok', token: token.id }
  
}