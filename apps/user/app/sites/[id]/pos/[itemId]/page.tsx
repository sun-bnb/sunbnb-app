import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import PosView from './view'

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
    return [item, pair]    
  }
  
  return [item]

}

export default async function Pos({ params }: { params: { itemId: string }}) {

  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string

  const items = await getInventoryItems(params.itemId)

  if (!items) return <div>Item {params.itemId} not found</div>

  return <PosView items={items} apiKey={apiKey} stripePublicKey={STRIPE_PUBLIC_KEY}/>

}