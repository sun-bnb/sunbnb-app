import SitePage from '@/app/sites/site-page'
import RestaurantView from './view'

export default async function RestaurantPage({ params }: { params: { id: string } }) {
  return (
    <SitePage params={params} tab="restaurant">
      <RestaurantView />
    </SitePage>
  )
}
