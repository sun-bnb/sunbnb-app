'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { put } from '@vercel/blob'

export async function submitForm(
  previousState: { status: string, errors?: string[] },
  formData: FormData
) {
  
  const session = await auth()
  console.log('SUBMIT', formData, session)

  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const requiredFields = ['name', 'locationLat', 'locationLng']
  const errors = requiredFields.filter(field => !formData.get(field)).map(field => `${field} is required`)
  let priceVal = formData.get('price') as string
  let price = Number(priceVal)
  if (!priceVal || isNaN(price)) {
    errors.push(`Invalid price ${priceVal}`)
  }
  
  if (errors.length > 0) return { status: 'error', errors }

  const siteId = formData.get('id') as string
   
  const siteData = {
    name: formData.get('name') as string,
    price,
    locationLat: formData.get('locationLat') as string,
    locationLng: formData.get('locationLng') as string,
    user: {
      connect: { id: session.user.id }
    }
  }

  console.log('SITE DATA', siteData)
  
  if (!siteId) {

    await prisma.site.create({
      data: siteData
    })

    await prisma.$executeRaw`
      UPDATE "Site" SET coords = ST_MakePoint(${siteData.locationLat}::double precision, ${siteData.locationLng}::double precision)
      WHERE id = ${siteId}`
    
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

      await prisma.$executeRaw`
        UPDATE "Site" SET coords = ST_MakePoint(${siteData.locationLat}::double precision, ${siteData.locationLng}::double precision)
        WHERE id = ${siteId}`

      revalidatePath('/sites')
      return { status: 'ok' }

    } else {
        
      return { status: 'error', errors: [ 'Site not found' ] }
    
    }

  }

  
}

export async function saveContent(
  previousState: { status: string, errors?: string[] },
  formData: FormData
) {
  
  const session = await auth()
  console.log('SAVE CONTENT', formData, session)

  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const siteId = formData.get('id') as string

  const siteData: {
    description?: string,
    image?: string
  } = {
    description: formData.get('description') as string
  }

  const imageFile = formData.get('image') as File

  if (imageFile.size > 0) {
    const blob = await put(imageFile.name, imageFile, {
      access: 'public',
    })
    console.log('BLOB', blob)
    siteData.image = blob.url  
  }
  
  const site = await prisma.site.findFirst({ where: { id: siteId } })
  if (site) {

    console.log('Site data', siteData)
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


export async function createInventoryItem(
  inventoryItem: { siteId: string }
) {
  
  const session = await auth()
  console.log('ADD INV ITEM', inventoryItem, session)

  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const inventoryItemData = {
    number: Math.round(Math.random() * 10000),
    siteId: inventoryItem.siteId,
    userId: session.user.id,
    status: 'new',
    locationLat: '0',
    locationLng: '0'
  }

  console.log('CREATE INV ITEM', inventoryItemData)
  await prisma.inventoryItem.create({
    data: inventoryItemData
  })
  
  revalidatePath('/sites')

  return { status: 'ok' }
  
}

export async function addWorkingHpours(
  siteId: string,
  workingHours: { day: string, openTime: string, closeTime: string }
) {
  
  const session = await auth()
  console.log('ADD WORKING HOURS', workingHours, session)

  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const openTimeDate = new Date('2000-01-01T' + workingHours.openTime + ':00.000')
  const closeTimeDate = new Date('2000-01-01T' + workingHours.closeTime + ':00.000')
  const workingHoursData = {
    day: Number(workingHours.day),
    openTime: openTimeDate,
    closeTime: closeTimeDate,
    site: {
      connect: { id: siteId }
    }
  }

  console.log('CREATE WORKING HOURS', workingHoursData)
  await prisma.siteWorkingHours.create({
    data: workingHoursData
  })
  
  revalidatePath('/sites')

  return { status: 'ok' }
  
}

export async function deleteWorkingHours(
  id: string
) {
  
  const session = await auth()
  console.log('DEL WORKING HOURS', id, session)

  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  console.log('DELETE WORKING HOURS', id)
  await prisma.siteWorkingHours.delete({
    where: { id }
  })
  
  revalidatePath('/sites')

  return { status: 'ok' }
  
}

export async function deleteInventoryItem(
  id: string
) {
  
  const session = await auth()
  console.log('DEL INV ITEM', id, session)

  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  await prisma.inventoryItem.delete({
    where: { id }
  })
  
  revalidatePath('/sites')
  
  return { status: 'ok' }
  
}

export async function saveInventoryItem(
  id: string, 
  inventoryItem: { locationLat: string, locationLng: string }
) {
  
  const session = await auth()
  console.log('ADD INV ITEM', inventoryItem, session)

  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const inventoryItemData = {
    status: 'active',
    locationLat: inventoryItem.locationLat,
    locationLng: inventoryItem.locationLng
  }

  console.log('CREATE INV ITEM', inventoryItemData)
  await prisma.inventoryItem.update({
    where: { id },
    data: inventoryItemData
  })
  
  revalidatePath('/sites')

  return { status: 'ok' }
  
}