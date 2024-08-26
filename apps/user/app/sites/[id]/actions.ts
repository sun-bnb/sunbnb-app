'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { put } from '@vercel/blob'
import { waitUntil } from '@vercel/functions'

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

export async function saveReservation(
  reservation: { 
    userId: string,
    siteId: string,
    itemId?: string,
    type: string,
    from: Date, to: Date 
  }) {
  
  const session = await auth()
  console.log('SAVE RES', session, reservation)

  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const reservationData = {
    from: reservation.from,
    to: reservation.to,
    type: reservation.type,
    status: 'pending',
    item: {
      connect: { id: reservation.itemId }
    },
    site: {
      connect: { id: reservation.siteId }
    },
    user: {
      connect: { id: reservation.userId }
    }
  }

  console.log('CREATE RES', reservationData)
  const newReservation = await prisma.reservation.create({
    data: reservationData
  })

  console.log('NEW RES', newReservation)

  /*
  setTimeout(() => {
    console.log('change status')
    prisma.reservation.update({
      data: { status: 'confirmed' },
      where: { id: newReservation.id }
    }).then((res) => {
      console.log('status changed', res)
    })
  }, 6000)
  */
 
  waitUntil(
    new Promise((resolve) => {
      setTimeout(async () => {
        try {
          console.log('change status');
          const updatedReservation = await prisma.reservation.update({
            data: { status: 'confirmed' },
            where: { id: newReservation.id },
          });
          console.log('status changed', updatedReservation);
        } catch (error) {
          console.error('Error updating reservation status:', error);
        } finally {
          resolve(1);
        }
      }, 6000); // 6 seconds delay
    })
  );
  
  revalidatePath('/sites')

  return { status: 'ok', id: newReservation.id }
  
}