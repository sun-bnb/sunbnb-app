import type { ReceiptModel } from '@repo/data/receipt-model'
import ReceiptView from './ReceiptView'

/**
 * The receipt shell.
 *
 * The DTO that used to live here is now `ReceiptModel` in
 * `@repo/data/receipt-model`, shared by all three presenters (this HTML view,
 * the PDF document, and the email template) so they cannot drift apart again —
 * they already had, with the email showing a VAT rate where the others showed a
 * VAT amount.
 *
 * `platformSection` is gone rather than populated. Every route set it to null,
 * so the branch was unreachable — and it should stay unreachable: under the
 * agent model the consumer buys from the partner and pays the listed price,
 * while the platform's commission is a separate B2B invoice billed to the
 * partner. Putting it on a guest's receipt would show them a number they did
 * not pay and are not party to.
 */
export default function ReceiptPage({ receipt }: { receipt: ReceiptModel }) {
  return (
    <div className="App">
      <ReceiptView receipt={receipt} />
    </div>
  )
}
