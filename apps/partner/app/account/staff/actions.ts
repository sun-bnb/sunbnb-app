'use server'

import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

const MAX_NAME_LENGTH = 80

export async function getEmployees() {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  return await prisma.employee.findMany({
    where: { accountId: session.user.id },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
  })
}

export async function createEmployee(name: string) {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  const trimmed = name.trim()
  if (!trimmed) {
    return { status: 'error' as const, errors: ['Name is required'] }
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return { status: 'error' as const, errors: [`Name must be ${MAX_NAME_LENGTH} characters or fewer`] }
  }

  await prisma.employee.create({
    data: {
      accountId: session.user.id,
      name: trimmed,
      active: true,
    },
  })

  return { status: 'ok' as const }
}

export async function renameEmployee(id: string, name: string) {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  const trimmed = name.trim()
  if (!trimmed) {
    return { status: 'error' as const, errors: ['Name is required'] }
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return { status: 'error' as const, errors: [`Name must be ${MAX_NAME_LENGTH} characters or fewer`] }
  }

  // updateMany with compound where scopes the update to the account —
  // a user cannot rename another account's employee.
  const { count } = await prisma.employee.updateMany({
    where: { id, accountId: session.user.id },
    data: { name: trimmed },
  })

  if (count === 0) {
    return { status: 'error' as const, errors: ['Employee not found'] }
  }

  return { status: 'ok' as const }
}

export async function setEmployeeActive(id: string, active: boolean) {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  // updateMany with compound where scopes the update to the account.
  // Deactivating keeps the employee record for history — never hard-delete
  // via this action.
  await prisma.employee.updateMany({
    where: { id, accountId: session.user.id },
    data: { active },
  })

  return { status: 'ok' as const }
}

export async function deleteEmployee(id: string) {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')

  // deleteMany with compound where scopes the deletion to the account.
  // The schema uses onDelete: SetNull on reservation/rental FKs so deleting
  // an employee nulls their attribution but keeps the transactions — safe.
  await prisma.employee.deleteMany({
    where: { id, accountId: session.user.id },
  })

  return { status: 'ok' as const }
}
