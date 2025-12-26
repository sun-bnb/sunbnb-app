import SitePage from '@/app/sites/site-page'
import BrandView from './view'

export default async function BrandPage({ params }: { params: { id: string } }) {

  return (
    <SitePage params={params} tab="brand">
      <BrandView />
    </SitePage>
  )

}