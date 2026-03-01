import { auth } from '@/app/auth'
import CreateSiteWizard from './create-site-wizard'

export default async function CreateSitePage() {

  const session = await auth()
  if (!session?.user) return null

  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string

  return (
    <div className="container mx-auto max-w-[768px]">
      <CreateSiteWizard apiKey={apiKey} />
    </div>
  )
}
