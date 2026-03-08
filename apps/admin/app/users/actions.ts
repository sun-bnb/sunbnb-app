'use server'

import prisma from '@repo/data/PrismaCient'

export async function getAdminUsers() {
  return prisma.adminUser.findMany({
    orderBy: { createdAt: 'desc' },
  })
}

export async function addAdminUser(email: string) {
  const trimmed = email.trim().toLowerCase()
  if (!trimmed || !trimmed.includes('@')) {
    return { status: 'error', error: 'Please enter a valid email address' }
  }

  const existing = await prisma.adminUser.findUnique({ where: { email: trimmed } })
  if (existing) {
    return { status: 'error', error: 'This email is already in the admin list' }
  }

  const user = await prisma.adminUser.create({
    data: { email: trimmed },
  })

  return { status: 'ok', user }
}

export async function removeAdminUser(id: string) {
  await prisma.adminUser.delete({ where: { id } })
  return { status: 'ok' }
}
