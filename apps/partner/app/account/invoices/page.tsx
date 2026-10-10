import { redirect } from 'next/navigation'
import { auth } from '@/app/auth'
import {
  listCommissionInvoices,
  commissionInvoiceMonths,
} from '@repo/data/commission-invoice'
import CommissionInvoicesView from './view'

/**
 * The partner's commission invoices from us (track 026 phase 6a).
 *
 * ## Why this page did not exist before
 *
 * We invoice partners for commission on every sale and they could see one
 * number for it: a year-to-date aggregate on the dashboard. There was no list
 * and no document — `getInvoicesByMonth` on the accounting page filters
 * `issuerType: 'PARTNER'`, and the revenue CSV is reservation statistics. So a
 * partner's accountant had no way to obtain the B2B invoices their own books
 * need, which is an ordinary invoicing failure rather than a Veri*factu one.
 *
 * Lives under `/account` and not under a site, because the invoice is
 * account-level: commission is billed to the PartnerAccount and a partner with
 * two venues gets one invoice stream, not two.
 *
 * The month comes from the query string so a link to a month is shareable with
 * an accountant, and defaults to the newest month that actually HAS invoices —
 * not to today, which for a seasonal beach business is empty most of the year
 * and would read as a broken page.
 */
export default async function CommissionInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>
}) {
  const { year: yearParam, month: monthParam } = await searchParams
  const session = await auth()
  if (!session?.user) redirect('/api/auth/signin')

  const months = await commissionInvoiceMonths(session.user.id)

  const requestedYear = Number.parseInt(yearParam ?? '', 10)
  const requestedMonth = Number.parseInt(monthParam ?? '', 10)
  const valid =
    Number.isInteger(requestedYear) &&
    Number.isInteger(requestedMonth) &&
    requestedMonth >= 1 &&
    requestedMonth <= 12

  const now = new Date()
  const fallback = months[0] ?? { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }
  const year = valid ? requestedYear : fallback.year
  const month = valid ? requestedMonth : fallback.month

  const invoices = await listCommissionInvoices(session.user.id, year, month)

  return (
    <CommissionInvoicesView
      year={year}
      month={month}
      months={months}
      invoices={invoices.map((i) => ({ ...i, invoicedAt: i.invoicedAt.toISOString() }))}
    />
  )
}
