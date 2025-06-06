'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

import { generateChairs, ChairConfig } from './chair-util'

export async function syncChairsWithLayout(siteId: string, config: ChairConfig) {
  const session = await auth()
  const generated = generateChairs(config)

  // Fetch existing items in the group
  const existing = await prisma.inventoryItem.findMany({
    where: { siteId, group: config.group },
    select: { id: true, number: true },
  })

  const existingMap = new Map(existing.map((e) => [e.number, e.id]))

  // Separate updates and creations
  const updates = generated.filter((g) => existingMap.has(g.number))
  const creations = generated.filter((g) => !existingMap.has(g.number))

  // 1. Update existing items
  await Promise.all(
    updates.map((item) =>
      prisma.inventoryItem.update({
        where: { id: existingMap.get(item.number)! },
        data: {
          locationLat: item.locationLat,
          locationLng: item.locationLng,
          rotation: item.rotation,
          group: item.group,
          number: item.number,
          pairId: null, // clear for now
        },
      })
    )
  )

  // 2. Create new items with null pairId
  const createdItems = await Promise.all(
    creations.map((item) =>
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
          pairId: null,
        },
      })
    )
  )

  // 3. Load full updated group (with ids)
  const allItems = await prisma.inventoryItem.findMany({
    where: { siteId, group: config.group },
    select: { id: true, number: true },
  })

  // Map number to DB id
  const numberToId = new Map(allItems.map((i) => [i.number, i.id]))
  const tempToNumber = new Map(generated.map((i) => [i.tempId, i.number]))

  // 4. Assign pairIds based on tempId → number → id
  for (const item of generated) {
    if (!item.pairTempId) continue
    const itemId = numberToId.get(item.number)
    const pairNumber = tempToNumber.get(item.pairTempId)
    const pairId = pairNumber ? numberToId.get(pairNumber) : undefined

    if (itemId && pairId) {
      await prisma.inventoryItem.update({
        where: { id: itemId },
        data: { pairId },
      })
    }
  }

  revalidatePath(`/sites/${siteId}/inventory`)
}
