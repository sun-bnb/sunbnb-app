import { isValidSiteCode, normalizeSiteCode } from '@repo/data/site-code'
import PosView from '@/app/sites/[id]/pos/view'
import ErrorCard from '@/components/ErrorCard'
import { getPosSite } from '@/app/sites/[id]/pos/queries'

/**
 * Venue QR entry (track 022) — `/q/{siteCode}`, the short form of
 * `/sites/{id}/pos`. The code is the whole key: it is what a printed venue card
 * carries, and unlike the slug it is immutable, so a rebrand cannot orphan a
 * card.
 *
 * The code is validated before the query. Malformed input here is a scanner or
 * a crawler, and it should cost a regex.
 */
export default async function QrVenuePage({ params }: { params: { site: string }}) {

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY
    || process.env.GOOGLE_MAPS_API_KEY as string

  const notFound = <ErrorCard title="Beach not found" message="We couldn't find the beach you're looking for." />

  if (!isValidSiteCode(params.site)) return notFound

  const site = await getPosSite({ code: normalizeSiteCode(params.site) })

  if (!site) return notFound

  return <PosView site={site} apiKey={apiKey}/>

}
