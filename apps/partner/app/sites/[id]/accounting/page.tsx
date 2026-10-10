import SitePage from '@/app/sites/site-page'
import AccountingView from './view'

export default async function AccountingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return (
    <SitePage params={{ id }} tab="accounting">
      <AccountingView />
    </SitePage>
  )

}