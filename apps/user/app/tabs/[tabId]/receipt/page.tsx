import { buildTabReceipt } from '@repo/data/receipt'
import ReceiptPage from '@/app/reservations/[id]/receipt/ReceiptPage'

/**
 * Consumer receipt for a dine-in tab — the surface that had none.
 *
 * That was not a rendering gap: issuing the receipt is the primary obligation,
 * and the QR that will go on it later is decoration on top. A guest who paid
 * for a meal at a table could not obtain any document for it.
 *
 * NO ownership check, deliberately — the tab id is the credential, the same
 * rule `/tables/[tableId]` ordering and payment already follow. A tab has an
 * opener recorded (`userId`/`anonId`), but a table is shared: the person who
 * opened the tab is routinely not the person who pays, and gating the receipt
 * on the opener would lock out the payer for their own meal.
 */
export default async function TabReceipt({ params }: { params: Promise<{ tabId: string }> }) {
  const { tabId } = await params
  const result = await buildTabReceipt(tabId)

  if (result.status === 'not-found') return <div>Tab not found</div>
  if (result.status === 'no-invoice') return <div>Receipt is not ready yet</div>

  return <ReceiptPage receipt={result.receipt} />
}
