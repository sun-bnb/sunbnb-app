import SitePage from '@/app/sites/site-page'

import InventoryView from './view'

export default async function InventoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <SitePage params={{ id }} tab="inventory">
      <InventoryView />
    </SitePage>
  )

}