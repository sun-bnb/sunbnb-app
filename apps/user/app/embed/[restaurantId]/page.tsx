import { notFound } from 'next/navigation'
import prisma from '@repo/data/PrismaCient'
import { isFlagEnabled } from '@/app/flags'
import EmbedBookingView from './view'

/**
 * Public, framable booking widget — a venue embeds this on its own site via
 * embed.js (an auto-resizing iframe). Restaurant-keyed (not site-keyed) so it
 * works for standalone restaurants too. Chrome is suppressed for `/embed` in
 * app.tsx, and cross-origin framing is permitted for `/embed` in next.config.mjs.
 * The booking itself runs against the public availability + /book APIs.
 */
export default async function EmbedBookingPage({
  params,
  searchParams,
}: {
  params: { restaurantId: string }
  searchParams: { date?: string; partySize?: string }
}) {
  if (!(await isFlagEnabled('restaurants'))) notFound()

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: params.restaurantId },
    select: { id: true, name: true, reservationWindow: true, siteId: true },
  })
  if (!restaurant) notFound()

  return (
    <EmbedBookingView
      restaurant={{
        id: restaurant.id,
        name: restaurant.name,
        reservationWindow: restaurant.reservationWindow,
        siteId: restaurant.siteId,
      }}
      initialDate={searchParams.date}
      initialPartySize={searchParams.partySize ? Number(searchParams.partySize) : undefined}
    />
  )
}
