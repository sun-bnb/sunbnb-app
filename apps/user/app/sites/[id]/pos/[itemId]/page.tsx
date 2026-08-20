import { redirect } from 'next/navigation'
import { formatUnitLocation } from '@repo/data/unit-address'
import PosView from './view'
import ErrorCard from '@/components/ErrorCard'
import { loadPosUnitByItem, posAvailability } from './queries'
import { preserveQuery } from '@/app/q/preserve-query'

export default async function Pos({ params, searchParams }: {
  params: { itemId: string },
  searchParams: Record<string, string | string[] | undefined>
}) {

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY
    || process.env.GOOGLE_MAPS_API_KEY as string

  const unit = await loadPosUnitByItem(params.itemId)

  if (!unit) return <ErrorCard title="Item not found" message="We couldn't find the sunbed you're looking for." />

  // Prefer the short, address-keyed URL (track 022): `/q/{siteCode}/{parcel}-{row}-{seq}`.
  // CONDITIONAL on purpose — a site whose code has not been backfilled yet, or a
  // unit with no address (production has not received track 021's address
  // columns), would redirect to a URL that resolves to nothing, taking every
  // card already glued to a lounger with it. The render below is the fallback
  // for exactly that window; it is not a second implementation, since both
  // paths share `posAvailability`.
  if (unit.site?.code && unit.address) {
    redirect(`/q/${unit.site.code}/${formatUnitLocation(unit.address)}${preserveQuery(searchParams)}`)
  }

  return (
    <PosView
      items={unit.items}
      site={unit.site}
      availableItemIds={await posAvailability(unit.site, unit.items)}
      apiKey={apiKey}
    />
  )

}
