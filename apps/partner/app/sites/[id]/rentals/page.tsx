import SitePage from '@/app/sites/site-page'
import RentalsView from './view'

export default async function RentalsPage({ params }: { params: { id: string } }) {

  return (
    <SitePage params={params} tab="rentals">
      <RentalsView />
    </SitePage>
  )

}
