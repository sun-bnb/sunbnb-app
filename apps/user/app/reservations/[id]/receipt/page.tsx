import { auth } from '@/app/auth'
import { buildOrderReceipt, buildReservationReceipt, type ReceiptResult } from '@repo/data/receipt'
import ReceiptPage from './ReceiptPage'

/**
 * Consumer receipt for a sunbed reservation, or for an F&B order when
 * `?orderId=` is present.
 *
 * The query and the mapping used to live here and were near-copies of the
 * rental route's; both now go through `@repo/data/receipt`. What stays here is
 * the part that genuinely belongs to a route: the session, and the ownership
 * check it enables.
 */
export default async function Receipt({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string }>
}) {
  const { id } = await params
  const { orderId, anonId: anonIdParam } = await searchParams
  const session = await auth()

  const result: ReceiptResult = orderId
    ? await buildOrderReceipt(orderId)
    : await buildReservationReceipt(id)

  if (result.status === 'not-found') {
    return <div>{orderId ? 'Order not found' : 'Reservation not found'}</div>
  }
  if (result.status === 'no-invoice') {
    return <div>Receipt is not ready yet</div>
  }

  // Ownership: a signed-in guest must own it; an anonymous one must present the
  // anonId their booking was made with.
  const owner = result.owner
  if (owner) {
    const authorized = session?.user?.id
      ? owner.userId === session.user.id
      : Boolean(anonIdParam) && owner.anonId === anonIdParam
    if (!authorized) return <div>Not authorized</div>
  }

  return <ReceiptPage receipt={result.receipt} />
}
