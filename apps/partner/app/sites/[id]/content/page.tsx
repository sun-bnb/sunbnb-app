import SitePage from '@/app/sites/site-page'
import SecurityView from './view'

export default async function SecurityPage({ params }: { params: { id: string } }) {

  return (
    <SitePage params={params} tab="security">
      <SecurityView />
    </SitePage>
  )

}