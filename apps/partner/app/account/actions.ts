'use server'

import { revalidatePath } from 'next/cache';
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

export async function submitForm(
  previousState: { status: string, errors?: string[] },
  formData: FormData
) {
  
  const session = await auth()

  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const requiredFields = ['firstName', 'lastName', 'email', 'phoneNumber', 'company', 'address', 'city', 'postalCode', 'country', 'businessId']
  const fieldLabels: Record<string, string> = {
    firstName: 'First name', lastName: 'Last name', email: 'Email',
    phoneNumber: 'Phone number', company: 'Company name', address: 'Address',
    city: 'City', postalCode: 'Postal code', country: 'Country',
    businessId: 'Business ID',
  }
  const errors = requiredFields.filter(field => !formData.get(field)).map(field => `${fieldLabels[field] ?? field} is required`)
  if (errors.length > 0) return { status: 'error', errors }

  const accountData = {
    userId: session.user.id,
    firstName: formData.get('firstName') as string,
    lastName: formData.get('lastName') as string,
    email: formData.get('email') as string,
    phoneNumber: formData.get('phoneNumber') as string,
    company: formData.get('company') as string,
    businessId: formData.get('businessId') as string,
    websiteUrl: formData.get('websiteUrl') as string,
    address: formData.get('address') as string,
    city: formData.get('city') as string,
    postalCode: formData.get('postalCode') as string,
    country: formData.get('country') as string,
    bankAccount: formData.get('bankAccount') as string
  }

  const account = await prisma.partnerAccount.findUnique({ where: { userId: session.user.id } })

  if (!account) {
    
    await prisma.partnerAccount.create({
      data: accountData
    })

    // Auto-assign STARTER subscription to new partner accounts
    const starterPlan = await prisma.subscriptionPlan.findUnique({ where: { tier: 'STARTER' } })
    if (starterPlan) {
      await prisma.subscription.create({
        data: {
          partnerAccountId: session.user.id,
          planId: starterPlan.id,
          status: 'ACTIVE',
        },
      })
    }
    
    revalidatePath('/account')
    return { status: 'ok' }

  } else {

    await prisma.partnerAccount.update({
      data: accountData,
      where: {
        userId: account.userId
      }

    })

    revalidatePath('/account')
    return { status: 'ok' }

  }
  
}