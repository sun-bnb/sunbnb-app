import prisma from '@repo/data/PrismaCient'
import PosView from './view'
import ErrorCard from '@/components/ErrorCard'

const { STRIPE_PUBLIC_KEY } = process.env

async function getInventoryItems(id: string) {
  
  const item = await prisma.inventoryItem.findUnique({ 
    where: { id: id },
    include: {
      reservations: true,
      site: true,
      pair: {
        include: {
          reservations: true
        }
      },
      pairedBy: {
        include: {
          reservations: true
        }
      }
    }
  })

  if (!item) return null

  const pair = item.pair || item.pairedBy
  if (pair) {
    return {
      site: item.site,
      items: [item, pair]
    }    
  }
  
  return {
    site: item.site,
    items: [item] 
  }

}

export default async function Pos({ params }: { params: { itemId: string }}) {

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY
    || process.env.GOOGLE_MAPS_API_KEY as string

  const items = await getInventoryItems(params.itemId)

  if (!items) return <ErrorCard title="Item not found" message="We couldn't find the sunbed you're looking for." />

  return <PosView items={items.items} site={items.site} apiKey={apiKey} stripePublicKey={STRIPE_PUBLIC_KEY}/>

}