import SitePage from '@/app/sites/site-page'
import MenuView from './view'

export default async function MenuPage({ params }: { params: { id: string } }) {
  return (
    <SitePage params={params} tab="restaurant">
      <MenuView />
    </SitePage>
  )
}
