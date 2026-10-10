import SitePage from '@/app/sites/site-page'
import ProductsView from './view'

export default async function ProductsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <SitePage params={{ id }} tab="products">
      <ProductsView />
    </SitePage>
  )

}