import prisma from '@repo/data/PrismaCient'
import PosView from './view'
import ErrorCard from '@/components/ErrorCard'

async function getSite(id: string) {
  return await prisma.site.findUnique({ 
    where: { id: id },
    include: {
      inventoryItems: {
        include: {
          reservations: {
            orderBy: { from: 'desc' }
          },
          pair: true,
          pairedBy: true
        }
      }
    }
  })
}

export default async function SitePos({ params }: { params: { id: string }}) {

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY
    || process.env.GOOGLE_MAPS_API_KEY as string

  const site = await getSite(params.id)

  if (!site) return <ErrorCard title="Beach not found" message="We couldn't find the beach you're looking for." />

  return <PosView site={site} apiKey={apiKey}/>

}