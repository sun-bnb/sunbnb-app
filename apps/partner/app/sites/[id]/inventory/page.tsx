import SitePage from '@/app/sites/site-page'

import InventoryContainer from './InventoryContainer'

export default async function InventoryPage({ params }: { params: { id: string } }) {

  return (
    <SitePage params={params} tab="inventory">
      <InventoryContainer />
    </SitePage>
  )

}