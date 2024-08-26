import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import { SiteProps } from '@/app/sites/types'
import SiteView from './view'

export default async function Site({ params, searchParams }: { params: { id: string }, searchParams: URLSearchParams }) {

  console.log('params', params)
  const session = await auth()
  if (!session?.user) return null

  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string
  console.log('API KEY', apiKey)

  let site: SiteProps | null = {
    name: ''
  }

   
    if (!site) return <div>Site {params.id} not found</div>

  return (
    <div className="container mx-auto lg:px-4">
      <SiteView site={site} apiKey={apiKey} />
    </div>
  )

}