import SitePage from '@/app/sites/site-page'
import { SharedMapProvider } from './SharedMapContext'
import InventoryView from './view'

export default async function InventoryPage({ params }: { params: { id: string } }) {

  return (
    <SitePage params={params} tab="inventory">
      <SharedMapProvider>
        <InventoryView />
      </SharedMapProvider>
    </SitePage>
  )

}