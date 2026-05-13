'use server'

import { revalidatePath } from 'next/cache';
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

/** Trim and truncate a string field to a max length. */
function sanitize(value: string | null, maxLength = 255): string {
  return (value ?? '').trim().slice(0, maxLength)
}

/** Basic email format validation. */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export async function submitForm(
  previousState: { status: string, errors?: string[] },
  formData: FormData
) {
  
  const session = await auth()
  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const requiredFields = ['firstName', 'lastName', 'email', 'phoneNumber', 'company', 'address']
  const errors = requiredFields.filter(field => !formData.get(field)).map(field => `${field} is required`)
  if (errors.length > 0) return { status: 'error', errors }

  const email = sanitize(formData.get('email') as string)
  if (!isValidEmail(email)) {
    return { status: 'error', errors: ['Invalid email format'] }
  }

  const accountData = {
    userId: session.user.id,
    firstName: sanitize(formData.get('firstName') as string),
    lastName: sanitize(formData.get('lastName') as string),
    email,
    phoneNumber: sanitize(formData.get('phoneNumber') as string, 50),
    company: sanitize(formData.get('company') as string),
    websiteUrl: sanitize(formData.get('websiteUrl') as string, 2048),
    address: sanitize(formData.get('address') as string, 500),
    bankAccount: sanitize(formData.get('bankAccount') as string, 100)
  }

  const account = await prisma.partnerAccount.findUnique({ where: { userId: session.user.id } })

  if (!account) {
    return { status: 'error', errors: ['Partner accounts can only be created from the partner app'] }
  }

  await prisma.partnerAccount.update({
    data: accountData,
    where: { userId: account.userId },
  })

  revalidatePath('/account')
  return { status: 'ok' }

}