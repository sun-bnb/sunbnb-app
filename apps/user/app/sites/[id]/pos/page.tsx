import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import PosView from './view'

const { STRIPE_PUBLIC_KEY } = process.env

async function getSite(id: string) {
  return await prisma.site.findUnique({ 
    where: { id: id },
    include: {
      inventoryItems: {
        include: {
          reservations: {
            orderBy: { from: 'desc' }
          }
        }
      }
    }
  })
}

export default async function SitePos({ params }: { params: { id: string }}) {

  console.log('params', params)

  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string
  console.log('API KEY', apiKey)

  const site = await getSite(params.id)

  if (!site) return <div>Site {params.id} not found</div>

  return <PosView site={site} apiKey={apiKey} stripePublicKey={STRIPE_PUBLIC_KEY}/>

}