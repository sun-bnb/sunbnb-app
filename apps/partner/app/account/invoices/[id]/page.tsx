import { notFound, redirect } from 'next/navigation'
import { auth } from '@/app/auth'
import { buildCommissionInvoice } from '@repo/data/commission-invoice'
import CommissionInvoiceDocument from './view'

/**
 * One commission invoice, as a document (track 026 phase 6a).
 *
 * Printable rather than a generated PDF. The browser's own print-to-PDF gives an
 * accountant the file they need, which `@react-pdf/renderer` would too — but
 * that renderer is client-side everywhere else in this repo, and the partner
 * surface is a server component with the real amounts in it. A print stylesheet
 * is the smaller correct thing; a server-rendered PDF is a later addition and
 * not a compliance requirement (art. 20 asks for the QR on the document, not for
 * a particular file format).
 *
 * Ownership is enforced inside `buildCommissionInvoice`, which scopes on
 * `accountId` and returns null for "not yours" and "no such invoice" alike — so
 * this renders `notFound()` for both and never confirms that another partner's
 * invoice exists.
 */
export default async function CommissionInvoicePage({
  params,
}: {
  params: { id: string }
}) {
  const session = await auth()
  if (!session?.user) redirect('/api/auth/signin')

  const invoice = await buildCommissionInvoice(params.id, session.user.id)
  if (!invoice) notFound()

  return <CommissionInvoiceDocument invoice={invoice} />
}
