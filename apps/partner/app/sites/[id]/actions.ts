'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { put } from '@vercel/blob'
import sharp from 'sharp'
import dayjs from 'dayjs'
import { SiteProps } from '../../../types/shared'
import { group } from 'console'

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
  if (priceVal && isNaN(Number(priceVal))) {
    errors.push(`Invalid price ${priceVal}`)
  }
  
  if (errors.length > 0) return { status: 'error', errors }

  const siteId = formData.get('id') as string
  
  let price = Number(priceVal)
  const siteData = {
    name: formData.get('name') as string,
    price: price > 0 ? price : null,
    locationLat: formData.get('locationLat') as string,
    locationLng: formData.get('locationLng') as string,
    user: {
      connect: { id: session.user.id }
    }
  }

  console.log('SITE DATA', siteData)

  if (!siteId) {

    const { id: siteId } = await prisma.site.create({
      data: siteData
    })

    console.log('SITE ID', siteId)

    await prisma.$executeRaw`
      UPDATE "Site" SET coords = ST_MakePoint(location_lat::double precision, location_lng::double precision)
      WHERE id = ${siteId}`
    
    revalidatePath('/sites')
    return { status: 'ok', siteId }

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

export async function deleteSite(
  id: string
) {
  
  const session = await auth()
  console.log('DEL SITE', id, session)

  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  await prisma.site.delete({
    where: { id }
  })
  
  revalidatePath('/sites')
  
  return { status: 'ok' }
  
}

export async function setSiteStatus(
  id: string, status: string
) {
  
  const session = await auth()
  console.log('UPDATE SITE STATUS', id, session)

  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  await prisma.site.update({
    where: { id },
    data: { status }
  })
  
  revalidatePath('/sites')
  
  return { status: 'ok' }
  
}

export async function saveContent(
  previousState: { status: string, errors?: string[] },
  formData: FormData
) {
  
  const session = await auth()
  console.log('SAVE CONTENT', formData, session)

  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const siteId = formData.get('id') as string
  const services = formData.get('services') as string
  let servicesArr: string[] = []
  if (services && services.length > 0) {
    servicesArr = services.split(',')
  }

  const siteData: any = {
    description: formData.get('description') as string,
    services: servicesArr
  }

  const imageFile = formData.get('image') as File

  if (imageFile.size > 0) {

    const buffer = Buffer.from(await imageFile.arrayBuffer())
    const image = sharp(buffer)
    const metadata = await image.metadata()

    if (!metadata.width || !metadata.height) {
      console.log('Could not determine image dimensions')
    } else {
      siteData.imageWidth = metadata.width
      siteData.imageHeight = metadata.height
    }

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

export async function updateVat(
  previousState: { status: string, errors?: string[] },
  formData: FormData
) {
  
  const session = await auth()
  console.log('SAVE CONTENT', formData, session)

  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const siteId = formData.get('id') as string
  const vat = formData.get('vat') as string

  const siteData: any = {
    vat: Number(vat)
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

  const lastItem = await prisma.inventoryItem.findFirst({
    where: { siteId: inventoryItem.siteId },
    orderBy: { number: 'desc' }
  })

  const inventoryItemData = {
    number: (lastItem?.number || 0) + 1,
    siteId: inventoryItem.siteId,
    userId: session.user.id,
    status: 'new',
    locationLat: '0',
    locationLng: '0'
  }

  console.log('CREATE INV ITEM', inventoryItemData)
  const item = await prisma.inventoryItem.create({
    data: inventoryItemData
  })
  
  revalidatePath('/sites')

  return { status: 'ok', item: item }
  
}

export async function addWorkingHours(
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

export async function saveInventoryItemLocation(
  id: string, 
  inventoryItem: { 
    locationLat: string,
    locationLng: string
  }
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

export async function saveInventoryItemProperties(
  id: string, 
  inventoryItem: { 
    category?: string,
    price?: number,
    rotation?: number,
    number?: number,
    group?: number,
    label?: string,
    pairId?: string
    status?: string
  }
) {
  
  const session = await auth()
  console.log('SAVE INV ITEM PROPS', inventoryItem, session)

  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const inventoryItemData = {
    category: inventoryItem.category,
    price: inventoryItem.price,
    rotation: inventoryItem.rotation,
    number: inventoryItem.number,
    group: inventoryItem.group,
    label: inventoryItem.label,
    status: inventoryItem.status
  }

  const pairItem = inventoryItem.pairId ? await prisma.inventoryItem.findUnique({
    where: { id: inventoryItem.pairId }
  }) : undefined

  console.log('SAVE INV ITEM PROPS DATA', inventoryItemData)
  await prisma.inventoryItem.update({
    where: { id },
    data: {
      ...inventoryItemData,
      pair: pairItem? { connect: { id: inventoryItem.pairId } } : undefined
    }
  })
  
  revalidatePath(`/sites`);

  return { status: 'ok' }
  
}

export async function cancelReservation(
  reservationId: string
) {
  
  const session = await auth()
  console.log('CANCEL RESERVATION', reservationId, session)

  if (!session?.user) return { status: 'error', errors: [ 'Not authenticated' ] }

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId }
  })

  await prisma.reservation.update({
    data: {
      status: 'canceled'
    },
    where: {
      id: reservationId
    }
  })
  
  revalidatePath(`/sites/${reservation?.siteId}`)

  return { status: 'ok' }
  
}

export async function selectItemsByGroup(siteId: string, group: number) {

  const items = await prisma.inventoryItem.findMany({
    where: { 
      siteId: siteId,
      group: group
    }
  })

  return items

}

export async function deleteItemsByGroup(siteId: string, group: number) {

  const items = await prisma.inventoryItem.deleteMany({
    where: { 
      siteId: siteId,
      group: group
    }
  })

  revalidatePath(`/sites/${siteId}/inventory`);
  return items

}


export async function moveItemsByGroup(
  siteId: string,
  group: number,
  direction: 'up' | 'down' | 'left' | 'right',
  stepMeters: number = 0.5
) {

  const items = await prisma.inventoryItem.findMany({
    where: {
      siteId,
      group
    },
    select: {
      id: true,
      locationLat: true,
      locationLng: true
    }
  })

  if (!items.length) return

  const baseLat = parseFloat(items[0]!.locationLat)
  const latStep = stepMeters / 111320 // Approximate meters per degree latitude
  const lngStep = stepMeters / 111320 / (Math.cos(baseLat * Math.PI / 180))

  const deltaLat = direction === 'up' ? latStep : direction === 'down' ? -latStep : 0
  const deltaLng = direction === 'right' ? lngStep : direction === 'left' ? -lngStep : 0

  for (const item of items) {
    const newLat = (parseFloat(item.locationLat) + (deltaLat)).toFixed(8)
    const newLng = (parseFloat(item.locationLng) + (deltaLng)).toFixed(8)
    console.log(`Moving item ${item.id} to new location: ${newLat}, ${newLng}`, deltaLat, deltaLng)
    const result = await prisma.inventoryItem.update({
      where: { id: item.id },
      data: {
        locationLat: newLat,
        locationLng: newLng
      }
    })

    console.log('Moved item', result)

  }

  revalidatePath(`/sites/${siteId}/inventory`)
  const site = await getSite(siteId)

  return site
  
}


export async function getInventoryItems(siteId: string) {

  const items = await prisma.inventoryItem.findMany({
    where: { 
      siteId: siteId
    }
  })

  return items

}

export async function getSite(siteId: string) {

  const site = await prisma.site.findFirst({ 
    where: { id: siteId }, 
    include: { 
      workingHours: true,
      inventoryItems: {
        orderBy: { number: 'asc' },
        include: {
          reservations: {
            include: {
              user: true
            },
            orderBy: { from: 'asc' }
          },
          pair: true,
          pairedBy: true
        }
      },
      products: {
        where: { active: true }
      }
    } 
  })

  return site

}


