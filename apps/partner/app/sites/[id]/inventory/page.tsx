import SitePage from '@/app/sites/site-page'
import InventoryView from './view'

export default async function InventoryPage({ params }: { params: { id: string } }) {

  return (
    <SitePage params={params} tab="inventory">
      <InventoryView />
    </SitePage>
  )

}