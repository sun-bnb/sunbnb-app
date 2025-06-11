'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'

import { generateChairs, ChairConfig } from './chair-util'

type Mode = 'create' | 'rearrange'

export async function syncChairsWithLayout(siteId: string, config: ChairConfig, mode: Mode) {
  const session = await auth()
  const generated = generateChairs(config)
  const group = config.group

  if (mode === 'create') {
    // Create all chairs
    await Promise.all(
      generated.map((item) =>
        prisma.inventoryItem.create({
          data: {
            userId: session?.user?.id,
            siteId,
            status: 'active',
            locationLat: item.locationLat,
            locationLng: item.locationLng,
            rotation: item.rotation,
            number: item.number,
            group: item.group,
            category: config.category,
            price: config.price,
            pairId: null,
          },
        })
      )
    )
  }

  if (mode === 'rearrange') {
    const existing = await prisma.inventoryItem.findMany({
      where: { siteId, group },
      select: { id: true, number: true },
    })

    const numberToId = new Map(existing.map((e) => [e.number, e.id]))

    // Update existing chairs in new layout
    await Promise.all(
      generated.map((item) => {
        const id = numberToId.get(item.number)
        if (!id) return Promise.resolve()

        return prisma.inventoryItem.update({
          where: { id },
          data: {
            locationLat: item.locationLat,
            locationLng: item.locationLng,
            rotation: item.rotation,
            number: item.number,
            group: item.group,
            category: config.category,
            price: config.price,
            pairId: null, // will be updated below
          },
        })
      })
    )
  }

  await assignChairPairings({ generated, group, siteId })

}


async function assignChairPairings({
  generated,
  group,
  siteId,
}: {
  generated: ReturnType<typeof generateChairs>
  group: number
  siteId: string
}) {
  const allItems = await prisma.inventoryItem.findMany({
    where: { siteId, group },
    select: { id: true, number: true },
  })

  const numberToId = new Map(allItems.map((i) => [i.number, i.id]))
  const tempToNumber = new Map(generated.map((i) => [i.tempId, i.number]))

  for (const item of generated) {
    if (!item.pairTempId || !item.isPrimary) continue

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
}
