import SitePage from '@/app/sites/site-page'
import ReservationsView from './view'

export default async function ReservationsPage({ params }: { params: { id: string } }) {
  return (
    <SitePage params={params} tab="restaurant">
      <ReservationsView />
    </SitePage>
  )
}
