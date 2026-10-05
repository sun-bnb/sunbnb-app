import type { Offer } from '@/lib/offer.ts'

/** The launch offer / founder promise (track 027 D8–D9). Renders nothing until the founder has supplied terms. */
export default function OfferNote({ offer, className = '' }: { offer: Offer | null; className?: string }) {
  if (!offer) return null
  return (
    <div className={`rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 ${className}`}>
      {offer.launchOffer && <p className="font-medium">{offer.launchOffer}</p>}
      {offer.founderPromise && <p className={offer.launchOffer ? 'mt-1' : ''}>{offer.founderPromise}</p>}
    </div>
  )
}
