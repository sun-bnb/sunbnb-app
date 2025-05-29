import SitePage from '@/app/sites/site-page'
import ProductsView from './view'

export default async function ProductsPage({ params }: { params: { id: string } }) {

  return (
    <SitePage params={params} tab="products">
      <ProductsView />
    </SitePage>
  )

}