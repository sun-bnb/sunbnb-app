import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import PosView from './view'

const { STRIPE_PUBLIC_KEY } = process.env

async function getInventoryItem(id: string) {
  return await prisma.inventoryItem.findUnique({ 
    where: { id: id },
    include: {
      reservations: true,
      site: true
    }
  })
}

export default async function Pos({ params }: { params: { itemId: string }}) {

  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string

  const item = await getInventoryItem(params.itemId)

  if (!item) return <div>Item {params.itemId} not found</div>

  return <PosView item={item} apiKey={apiKey} stripePublicKey={STRIPE_PUBLIC_KEY}/>

}