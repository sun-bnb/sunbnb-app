'use server'

import { revalidatePath } from 'next/cache'
import dayjs from 'dayjs'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { put } from '@vercel/blob'
import { waitUntil } from '@vercel/functions'
import { InventoryItem } from '../types'

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

  // if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const reservationData = {
    from: reservation.from,
    to: reservation.to,
    type: reservation.type,
    status: 'pending',
    paymentAmount: 0,
    items: {
      connect: [{ id: reservation.itemId }]
    },
    site: {
      connect: { id: reservation.siteId }
    },
    user: {
      connect: { id: reservation.userId }
    }
  }

  const site = await prisma.site.findUnique({ where: { id: reservation.siteId } })
  if (!site) return { status: 'error', errors: [ 'Site not found' ] }
  if (!site.price) return { status: 'error', errors: [ 'Site price not set' ] }

  reservationData.paymentAmount = site.price

  console.log('CREATE RES', reservationData)
  const newReservation = await prisma.reservation.create({
    data: reservationData
  })

  console.log('NEW RES', newReservation)
  
  revalidatePath('/sites')

  return { status: 'ok', id: newReservation.id }
  
}



export async function saveReservationForMultipleItems(
  reservation: { 
    userId?: string,
    anonId?: string,
    siteId: string,
    items?: InventoryItem[],
    type: string,
    from: string, to: string
  }) {
  
  console.log('SAVE RES', reservation)
  
  let reservationUserId = reservation.userId
  if (!reservationUserId) {
    const user = await prisma.user.findUnique({ where: { email: 'vhalme@gmail.com' } })
    if (!user) return { status: 'error', errors: [ 'User not found' ] }
    reservationUserId = user.id
  }

  const to = reservation.type === 'days' ?
    dayjs(reservation.to).add(1, 'day').subtract(1, 'second').toDate() :
    new Date(reservation.to)

  const reservationData = {
    from: new Date(reservation.from),
    to: to,
    type: reservation.type,
    status: 'pending',
    paymentAmount: 0,
    anonId: reservation.anonId,
    items: {
      connect: reservation.items?.map(item => ({ id: item.id }))
    },
    site: {
      connect: { id: reservation.siteId }
    },
    user: {
      connect: { id: reservationUserId }
    }
  }

  const site = await prisma.site.findUnique({ where: { id: reservation.siteId } })
  if (!site) return { status: 'error', errors: [ 'Site not found' ] }
  if (!site.price) return { status: 'error', errors: [ 'Site price not set' ] }

  const totalPrice = reservation.items?.reduce((sum, item) => {
    return sum + (item.price || site.price || 0)
  }, 0) ?? 0

  reservationData.paymentAmount = totalPrice

  console.log('CREATE RES', reservationData)
  const newReservation = await prisma.reservation.create({
    data: reservationData
  })

  console.log('NEW RES', newReservation)
  
  revalidatePath('/sites')

  return { status: 'ok', id: newReservation.id }
  
}

export async function createReservation(
  siteId: string,
  from: string,
  to: string
) {
  
  const session = await auth()
  console.log('CREATE RESERVATION', siteId, from, to, session)

  const site = await prisma.site.findUnique({ where: { id: siteId } })
  if (!site) return { status: 'error', errors: [ 'Site not found' ] }

  const user = await prisma.user.findUnique({ where: { email: 'vhalme@gmail.com' } })
  
  const reservation = await prisma.reservation.create({
    data: {
      user: {
        connect: { id: user!.id }
      },
      site: {
        connect: { id: siteId }
      },
      from: new Date(from),
      to: new Date(to),
      status: 'pending'
    }
  })
  
  revalidatePath('/sites')

  return {
    status: 'ok',
    reservation
  }
  
}

export async function findAnonReservation(
  anonId: string,
  itemId: string
) {

  const now = new Date()

  const reservation = await prisma.reservation.findFirst({
    where: {
      anonId: anonId,
      status: { in: ['paid', 'complete'] },
      from: { lte: now },
      to: { gte: now },
      items: {
        some: {
          id: { in: [itemId] },
        },
      }
    },
    include: {
      items: true,
      site: true
    }
  })

  console.log('reservation by anon found', reservation)

  return reservation
  
}

export async function findUserReservation(
  userId: string,
  itemId: string
) {

  const now = new Date()

  const reservation = await prisma.reservation.findFirst({
    where: {
      userId: userId,
      status: { in: ['paid', 'complete'] },
      from: { lte: now },
      to: { gte: now },
      items: {
        some: {
          id: { in: [itemId] },
        },
      }
    },
    include: {
      items: true,
      site: true
    }
  })

  console.log('reservation by user found', reservation)

  return reservation
  
}