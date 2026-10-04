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
    <div className="max-w-3xl mx-auto px-6 py-10">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Commission invoices</h1>
      <p className="text-xs text-gray-400 mb-8">
        Invoices Sunbnb has issued to you for platform commission. These are separate
        documents from your own sales receipts — your sales are invoiced gross, and the
        commission is billed to you here.
      </p>

      {props.months.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {props.months.map((m) => {
            const active = m.year === props.year && m.month === props.month
            return (
              <Link
                key={`${m.year}-${m.month}`}
                href={`/account/invoices?year=${m.year}&month=${m.month}`}
                className={
                  active
                    ? 'rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white'
                    : 'rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50'
                }
              >
                {monthLabel(m.year, m.month)}
                <span className={active ? 'ml-1.5 text-gray-300' : 'ml-1.5 text-gray-400'}>
                  {m.count}
                </span>
              </Link>
            )
          })}
        </div>
      )}

      <div className="card">
        <div className="flex items-baseline justify-between mb-4">
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
          <table className="w-full text-xs">
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
        )}
      </div>
    </div>
  )
}
