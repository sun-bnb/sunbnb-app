import { auth } from '@/app/auth'
import { buildRentalReceipt } from '@repo/data/receipt'
import ReceiptPage from '@/app/reservations/[id]/receipt/ReceiptPage'

/**
 * Consumer receipt for an equipment rental.
 *
 * This file was a near-copy of the reservation route, down to its own
 * `extractCountryCode` and section mapping. Both now share
 * `@repo/data/receipt`; a rental's only link to its invoice is the paymentRef
 * the group shares, which the loader owns.
 */
export default async function RentalReceipt({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string }>
}) {
  const { id } = await params
  const { anonId: anonIdParam } = await searchParams
  const session = await auth()

  const result = await buildRentalReceipt(id)

  if (result.status === 'not-found') return <div>Rental not found</div>
  if (result.status === 'no-invoice') return <div>Receipt is not ready yet</div>

  const owner = result.owner
  if (owner) {
    const authorized = session?.user?.id
      ? owner.userId === session.user.id
      : Boolean(anonIdParam) && owner.anonId === anonIdParam
    if (!authorized) return <div>Not authorized</div>
  }

  return <ReceiptPage receipt={result.receipt} />
}
