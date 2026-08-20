import { redirect } from 'next/navigation'
import PosView from './view'
import ErrorCard from '@/components/ErrorCard'
import { getPosSite } from './queries'
import { preserveQuery } from '@/app/q/preserve-query'

export default async function SitePos({ params, searchParams }: {
  params: { id: string },
  searchParams: Record<string, string | string[] | undefined>
}) {

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY
    || process.env.GOOGLE_MAPS_API_KEY as string

  const site = await getPosSite({ OR: [{ id: params.id }, { slug: params.id }] })

  if (!site) return <ErrorCard title="Beach not found" message="We couldn't find the beach you're looking for." />

  // Prefer the short, code-keyed URL (track 022). CONDITIONAL on purpose: a site
  // whose code has not been backfilled yet would otherwise redirect to `/q/null`
  // and take every printed card at that venue down with it. Rendering here is
  // the fallback, not a second implementation — both paths use `getPosSite`.
  if (site.code) redirect(`/q/${site.code}${preserveQuery(searchParams)}`)

  return <PosView site={site} apiKey={apiKey}/>

}
