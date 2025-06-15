import SitePage from '@/app/sites/site-page'

import InventoryPageView from './InventoryPage'

export default async function InventoryPage({ params }: { params: { id: string } }) {

  return (
    <SitePage params={params} tab="inventory">
      <InventoryPageView />
    </SitePage>
  )

}