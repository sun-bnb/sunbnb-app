import SitePage from '@/app/sites/site-page'
import ContentView from './view'

export default async function ContentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <SitePage params={{ id }} tab="content">
      <ContentView />
    </SitePage>
  )

}