import ThankYouView from './ThankYouView'

/**
 * Public post-payment thank-you page — the redirect target for the partner QR
 * walk-in collection. The beachgoer lands here after paying on Mollie; they can
 * optionally have a receipt emailed to themselves. No auth (they have no
 * account); the receipt action validates that the payment actually completed.
 */
export default function ThankYouPage({
  searchParams,
}: {
  searchParams: { reservationId?: string }
}) {
  return <ThankYouView reservationId={searchParams.reservationId ?? ''} />
}
