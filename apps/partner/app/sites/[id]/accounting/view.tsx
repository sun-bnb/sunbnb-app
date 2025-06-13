'use client'

import { useFormState } from 'react-dom'
import { useState, useEffect } from 'react'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import { updateVat } from '../actions'
import { useSite } from '@/app/sites/site-context'
import { getInvoicesByMonth, getPaidItemsByMonth } from './actions'

export default function Accounting() {
  const [formState, formAction] = useFormState(updateVat, { status: '' })
  const { site } = useSite()

  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const [invoices, setInvoices] = useState<any[]>([])
  const [paidItems, setPaidItems] = useState<{ orders: any[]; reservations: any[] }>({
    orders: [],
    reservations: []
  })

  useEffect(() => {
    if (!site?.id) return

    getInvoicesByMonth(site.id, selectedYear, selectedMonth).then(setInvoices)
    getPaidItemsByMonth(site.id, selectedYear, selectedMonth).then(setPaidItems)
  }, [selectedYear, selectedMonth, site?.id])

  return (
    <div className="container mx-auto p-4">
      <div className="mt-6 flex w-full">
        <form action={formAction} className="w-full">
          <input type="hidden" name="id" value={site.id} />
          <div className="mt-4 flex-1">
            <TextField
              name="vat"
              label="VAT"
              fullWidth
              multiline
              defaultValue={site.vat || ''}
              variant="standard"
            />
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="submit" variant="contained">Save</Button>
          </div>
        </form>
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold mb-2">View Invoices by Month</h2>
        <div className="flex gap-4 mb-4">
          <Select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}>
            {[2023, 2024, 2025].map(y => (
              <MenuItem key={y} value={y}>{y}</MenuItem>
            ))}
          </Select>
          <Select value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => (
              <MenuItem key={i + 1} value={i + 1}>
                {new Date(0, i).toLocaleString('default', { month: 'long' })}
              </MenuItem>
            ))}
          </Select>
        </div>
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold mb-2">Paid Orders and Reservations</h2>

        {paidItems.orders.length === 0 && paidItems.reservations.length === 0 ? (
          <p className="text-gray-500">No paid items for this month.</p>
        ) : (
          <ul className="divide-y">
            {paidItems.orders.map(order => (
              <li key={order.id} className="py-2 flex justify-between text-sm text-blue-700">
                <span>Order</span>
                <span>{new Date(order.invoice?.invoicedAt).toLocaleDateString()}</span>
                <span>{order.invoice?.totalAmount?.toFixed(2)} €</span>
              </li>
            ))}
            {paidItems.reservations.map(res => (
              <li key={res.id} className="py-2 flex justify-between text-sm text-green-700">
                <span>Reservation</span>
                <span>{new Date(res.invoice?.invoicedAt).toLocaleDateString()}</span>
                <span>{res.invoice?.totalAmount?.toFixed(2)} €</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
