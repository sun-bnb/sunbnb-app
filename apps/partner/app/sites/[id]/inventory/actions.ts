'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

import { generateChairs, applyChairsToExisting, ChairConfig } from './chair-util'


export async function syncChairsWithLayout(siteId: string, config: ChairConfig) {

  const generated = generateChairs(config)

  const existing = await prisma.inventoryItem.findMany({
    where: { siteId, group: config.group },
    select: { id: true, number: true },
  })

  const updatedItems = applyChairsToExisting(existing, generated)

  const updatePromises = updatedItems.map((item) =>
    prisma.inventoryItem.update({
      where: { id: item.id },
      data: {
        locationLat: item.locationLat,
        locationLng: item.locationLng,
        rotation: item.rotation,
        number: item.number,
        group: item.group,
        pairId: item.pairId || null,
      },
    })
  )

  // Handle creation of new items
  const newItems = generated.filter((g) =>
    !updatedItems.some((u) => u.number === g.number)
  )

  const session = await auth()

  const createPromises = newItems.map((item) =>
    prisma.inventoryItem.create({
      data: {
        userId: session?.user?.id,
        siteId,
        status: 'available',
        locationLat: item.locationLat,
        locationLng: item.locationLng,
        rotation: item.rotation,
        number: item.number,
        group: item.group,
        pairId: null, // handled in second pass
      },
    })
  )

  const createdItems = await Promise.all([...updatePromises, ...createPromises])

  // Second pass: update pairIds for newly created items
  const allItems = await prisma.inventoryItem.findMany({
    where: { siteId, group: config.group },
    select: { id: true, number: true },
  })

  const pairUpdates = generated
    .filter((g) => g.pairTempId)
    .map((g) => {
      const item = allItems.find((i) => i.number === g.number)
      const pair = allItems.find((i) => i.number === Number(g.pairTempId))

      if (item && pair) {
        return prisma.inventoryItem.update({
          where: { id: item.id },
          data: { pairId: pair.id },
        })
      }
      return null
    })
    .filter(Boolean)

  await Promise.all(pairUpdates)

  revalidatePath(`/sites/${siteId}/inventory`)
  
}
