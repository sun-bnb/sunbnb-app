'use client'

import Link from 'next/link'

interface Row {
  invoiceId: string
  invoiceNumber: string | null
  invoicedAt: string
  totalCharge: number
  totalTax: number
  totalAmount: number
  reverseCharge: boolean
}

interface Props {
  year: number
  month: number
  months: { year: number; month: number; count: number }[]
  invoices: Row[]
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function monthLabel(year: number, month: number): string {
  return `${MONTHS[month - 1] ?? month} ${year}`
}

export default function CommissionInvoicesView(props: Props) {
  const total = props.invoices.reduce((n, i) => n + i.totalAmount, 0)

  return (
    <div className="page-container py-6 sm:py-10">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Commission invoices</h1>
      <p className="text-xs text-gray-400 mb-8 max-w-2xl">
        Invoices Sunbnb has issued to you for platform commission. These are separate
        documents from your own sales receipts — your sales are invoiced gross, and the
        commission is billed to you here.
      </p>

      {/* lg+: months become a sticky side rail beside the invoice table. */}
      <div className={props.months.length > 1 ? 'lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:items-start lg:gap-8' : ''}>
      {props.months.length > 1 && (
        <nav aria-label="Months" className="flex flex-wrap gap-2 mb-6 lg:mb-0 lg:flex-col lg:flex-nowrap lg:sticky lg:top-6">
          {props.months.map((m) => {
            const active = m.year === props.year && m.month === props.month
            return (
              <Link
                key={`${m.year}-${m.month}`}
                href={`/account/invoices?year=${m.year}&month=${m.month}`}
                className={
                  active
                    ? 'rounded-md bg-accent px-3 py-2.5 sm:py-1.5 text-xs font-medium text-white lg:flex lg:justify-between'
                    : 'rounded-md border border-gray-200 px-3 py-2.5 sm:py-1.5 text-xs text-gray-600 hover:bg-gray-50 lg:flex lg:justify-between'
                }
              >
                {monthLabel(m.year, m.month)}
                <span className={active ? 'ml-1.5 text-gray-300' : 'ml-1.5 text-gray-400'}>
                  {m.count}
                </span>
              </Link>
            )
          })}
        </nav>
      )}

      <div className="card min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-4">
          <h2 className="text-sm font-semibold text-gray-900">
            {monthLabel(props.year, props.month)}
          </h2>
          {props.invoices.length > 0 && (
            <span className="text-xs text-gray-500">
              {props.invoices.length} invoice{props.invoices.length === 1 ? '' : 's'} ·{' '}
              {total.toFixed(2)} €
            </span>
          )}
        </div>

        {props.invoices.length === 0 ? (
          <p className="text-xs text-gray-500">
            No commission invoices for this month.
          </p>
        ) : (
          <>
          {/* Phone: one card per invoice — five numeric columns don't fit 360px. */}
          <ul className="sm:hidden divide-y divide-gray-100 -mx-4 border-t border-gray-100">
            {props.invoices.map((inv) => (
              <li key={inv.invoiceId}>
                <Link
                  href={`/account/invoices/${inv.invoiceId}`}
                  className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-gray-50"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 break-all">
                      {inv.invoiceNumber ?? '(no number)'}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                      <span>{inv.invoicedAt.slice(0, 10)}</span>
                      {inv.reverseCharge && (
                        <span className="badge bg-blue-50 border-blue-200 text-blue-700">
                          reverse charge
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-medium text-gray-900">
                      {inv.totalAmount.toFixed(2)} €
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {inv.totalCharge.toFixed(2)} + {inv.totalTax.toFixed(2)} VAT
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <table className="hidden sm:table w-full text-xs lg:text-sm">
            <thead>
              <tr className="text-gray-500 border-b border-gray-200">
                <th className="text-left py-2 font-medium">Number</th>
                <th className="text-left py-2 font-medium">Date</th>
                <th className="text-right py-2 font-medium">Base</th>
                <th className="text-right py-2 font-medium">VAT</th>
                <th className="text-right py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {props.invoices.map((inv) => (
                <tr key={inv.invoiceId} className="border-b border-gray-100">
                  <td className="py-2">
                    <Link
                      href={`/account/invoices/${inv.invoiceId}`}
                      className="font-medium text-gray-900 hover:underline"
                    >
                      {inv.invoiceNumber ?? '(no number)'}
                    </Link>
                    {inv.reverseCharge && (
                      <span className="badge ml-2 bg-blue-50 border-blue-200 text-blue-700">
                        reverse charge
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-gray-500">{inv.invoicedAt.slice(0, 10)}</td>
                  <td className="py-2 text-right text-gray-600">
                    {inv.totalCharge.toFixed(2)}
                  </td>
                  <td className="py-2 text-right text-gray-600">{inv.totalTax.toFixed(2)}</td>
                  <td className="py-2 text-right font-medium text-gray-900">
                    {inv.totalAmount.toFixed(2)} €
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
        )}
      </div>
      </div>
    </div>
  )
}
