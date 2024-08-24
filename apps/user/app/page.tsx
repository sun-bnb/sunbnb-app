import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'

import SitesView from './view'

export default async function Sites() {

  const session = await auth()
  if (!session?.user) return null

  const results = await prisma.site.findMany({
    where: { userId: session.user.id },
    include: {
      _count: {
        select: {
          inventoryItems: true,
        },
      },
      inventoryItems: {
        select: {
          status: true,
        },
      },
    },
  });

  const sites = results.map(r => {
    
    const availableCount = r.inventoryItems.filter(item => item.status === 'available').length

    const result = {
      ...r,
      itemCount: r._count.inventoryItems,
      availableCount
    }

    const { inventoryItems, ...site } = result
    return site

  })

  console.log('sites', sites)

  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string
  console.log('API KEY', apiKey)
  
  return <SitesView sites={sites} apiKey={apiKey} />

}