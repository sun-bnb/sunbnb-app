import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import { SiteProps } from '@/types/shared'
import SitePage from '@/app/sites/site-page'
import ContentView from './view'

export default async function ContentPage({ params }: { params: { id: string } }) {

  return (
    <SitePage params={params} tab="content">
      <ContentView />
    </SitePage>
  )

}