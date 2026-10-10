import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import { SiteProps } from '@/types/shared'
import SitePage from '@/app/sites/site-page'
import GeneralView from './view'

export default async function AccountingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <SitePage params={{ id }} tab="general">
      <GeneralView />
    </SitePage>
  )

}