'use server'

import { revalidatePath } from 'next/cache';
import { auth } from '@/app/auth'
import { PrismaClient } from '@prisma/client'
import { connect } from 'http2';

const prisma = new PrismaClient()

export async function submitForm(
  previousState: { status: string, errors?: string[] },
  formData: FormData
) {
  
  const session = await auth()
  console.log('SUBMIT', formData, session)

  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const requiredFields = ['name', 'locationLat', 'locationLng']
  const errors = requiredFields.filter(field => !formData.get(field)).map(field => `${field} is required`)
  if (errors.length > 0) return { status: 'error', errors }

  const siteId = formData.get('id') as string

  const siteData = {
    name: formData.get('name') as string,
    locationLat: formData.get('locationLat') as string,
    locationLng: formData.get('locationLng') as string,
    user: {
      connect: { id: session.user.id }
    }
  }

  if (!siteId) {

    await prisma.site.create({
      data: siteData
    })
    
    revalidatePath('/sites')
    return { status: 'ok' }

  } else {

    const site = await prisma.site.findFirst({ where: { id: siteId } })
    if (site) {

      await prisma.site.update({
        data: siteData,
        where: {
          id: siteId
        }

      })

      revalidatePath('/sites')
      return { status: 'ok' }

    } else {
        
      return { status: 'error', errors: [ 'Site not found' ] }
    
    }

  }

  
}