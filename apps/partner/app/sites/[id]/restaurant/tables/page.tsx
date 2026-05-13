import SitePage from '@/app/sites/site-page'
import TablesView from './view'

export default async function TablesPage({ params }: { params: { id: string } }) {
  return (
    <SitePage params={params} tab="restaurant">
      <TablesView />
    </SitePage>
  )
}
