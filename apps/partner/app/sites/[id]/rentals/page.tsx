import SitePage from '@/app/sites/site-page'
import RentalsView from './view'

export default async function RentalsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <SitePage params={{ id }} tab="rentals">
      <RentalsView />
    </SitePage>
  )

}
