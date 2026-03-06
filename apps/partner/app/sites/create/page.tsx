import { auth } from '@/app/auth'
import { canCreateSite } from '@repo/data/subscription'
import CreateSiteWizard from './create-site-wizard'
import Link from 'next/link'

export default async function CreateSitePage() {

  const session = await auth()
  if (!session?.user) return null

  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string
  const siteLimit = await canCreateSite(session.user.id!)

  if (!siteLimit.allowed) {
    return (
      <div className="container mx-auto max-w-[768px] px-4 py-6">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
          <svg className="w-10 h-10 text-amber-500 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <h2 className="text-base font-semibold text-amber-900 mb-1">Site limit reached</h2>
          <p className="text-sm text-amber-700 mb-4">
            Your <strong>{siteLimit.tier}</strong> plan allows up to {siteLimit.maxSites} site{siteLimit.maxSites !== 1 ? 's' : ''}.
            You currently have {siteLimit.currentCount}.
          </p>
          <Link
            href="/account/subscription"
            className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
          >
            View plans &amp; upgrade
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-[768px]">
      <CreateSiteWizard apiKey={apiKey} />
    </div>
  )
}
