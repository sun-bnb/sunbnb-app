import SitePage from '@/app/sites/site-page'
import BrandView from './view'

export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <SitePage params={{ id }} tab="brand">
      <BrandView />
    </SitePage>
  )

}