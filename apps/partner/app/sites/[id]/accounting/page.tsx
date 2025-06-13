import SitePage from '@/app/sites/site-page'
import AccountingView from './view'

export default async function AccountingPage({ params }: { params: { id: string } }) {

  return (
    <SitePage params={params} tab="accounting">
      <AccountingView />
    </SitePage>
  )

}