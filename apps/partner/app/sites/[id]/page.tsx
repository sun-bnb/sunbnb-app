import { auth } from '@/app/auth'
import { SiteProps } from '@/types/shared'
import CreateSiteView from './create-site'


export default async function Site({ params }: { params: { id: string } }) {

  const session = await auth()
  if (!session?.user) return null

  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string

  let site: SiteProps | null = {
    name: '',
    services: []
  }
  
  return (
    <div className="container mx-auto max-w-[768px]">
      <CreateSiteView  site={site} apiKey={apiKey} />
    </div>
  )

}