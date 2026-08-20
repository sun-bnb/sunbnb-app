import PosView from '@/app/sites/[id]/pos/[itemId]/view'
import ErrorCard from '@/components/ErrorCard'
import { posAvailability } from '@/app/sites/[id]/pos/[itemId]/queries'
import { resolveQrTarget } from '@/app/q/resolve'

/**
 * Seat QR entry (track 022) — `/q/{siteCode}/{parcel}-{row}-{seq}`, the short
 * form of `/sites/{id}/pos/{itemId}` and the URL printed on a lounger's card.
 *
 * It renders the SAME `PosView` and shares the SAME availability tail as the
 * legacy route; only the key differs — an ADDRESS, so the card belongs to the
 * spot rather than to a seat row that inventory editing can delete out from
 * under it (track 022 D1, [[track:021]]'s paradigm).
 */
export default async function QrSeatPage({ params }: { params: { site: string; unit: string }}) {

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY
    || process.env.GOOGLE_MAPS_API_KEY as string

  const target = await resolveQrTarget(params.site, params.unit)

  if (!target) return <ErrorCard title="Sunbed not found" message="We couldn't find the sunbed you're looking for." />

  return (
    <PosView
      items={target.items}
      site={target.site}
      availableItemIds={await posAvailability(target.site, target.items)}
      apiKey={apiKey}
    />
  )

}
