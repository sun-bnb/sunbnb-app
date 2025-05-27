'use client'

import { useState } from 'react'
import {
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Paper,
  Chip,
  Typography,
  Box,
  Button,
  List,
  ListItem,
  ListItemText,
  Divider,
} from '@mui/material'

import { Invoice } from '@/app/types/types'

const statusColorMap: Record<string, 'default'|'primary'|'success'|'warning'|'error'> = {
  pending:   'warning',
  paid:      'success',
  cancelled: 'error',
}

export default function Orders({ orders }: {
  orders: {
    id: string
    createdAt: Date
    totalPrice: number
    status: string
    orderItems: {
      id: string
      name: string
      quantity: number
      price: number
      tax: number
      totalPrice: number
    }[]
    invoice?: Invoice | null
  }[]
}) {
  const [selected, setSelected] = useState<string | null>(null)

  // find the currently selected order
  const order = orders.find(o => o.id === selected) || null

  return (selected && order) ? (
    // --- DETAILS VIEW ---
    <Box>
      {/* Header: date, status, and back button all in one line */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mt: 2,
          mb: 2,
          ml: 2
        }}
      >
        <Typography variant="subtitle1">
          {new Date(order.createdAt).toLocaleString(undefined, {
            year:   'numeric',
            month:  'short',
            day:    '2-digit',
            hour:   '2-digit',
            minute: '2-digit',
          })}
        </Typography>

        <Chip
          label={order.status.charAt(0).toUpperCase() + order.status.slice(1)}
          color={statusColorMap[order.status] ?? 'default'}
          size="small"
        />

        <Button size="small" onClick={() => setSelected(null)}>
          Back
        </Button>
      </Box>

      {
        order.invoice &&
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ pl: 1, pr: 1 }}>Item × Qty</TableCell>
                  <TableCell sx={{ pl: 1, pr: 1 }}align="right">Net (€)</TableCell>
                  <TableCell sx={{ pl: 1, pr: 1 }}align="right">Tax (€)</TableCell>
                  <TableCell sx={{ pl: 1, pr: 1 }}align="right">Gross (€)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {order.invoice.invoiceLines.map(line => {
                  const net      = line.charge
                  const total    = line.amount
                  const taxAmt   = line.tax
                  return (
                    <TableRow key={line.id}>
                      <TableCell>{`${line.description}`}</TableCell>
                      <TableCell align="right">{net.toFixed(2)}</TableCell>
                      <TableCell align="right">{taxAmt.toFixed(2)}</TableCell>
                      <TableCell align="right">{total.toFixed(2)}</TableCell>
                    </TableRow>
                  )
                })}

                {(() => {
                  const sumNet   = order.invoice.totalCharge
                  const sumTotal = order.invoice.totalAmount
                  const sumTax   = order.invoice.totalTax
                  return (
                    <TableRow sx={{ borderTop: 1, borderColor: 'divider' }}>
                      <TableCell>
                        <strong>Total</strong>
                      </TableCell>
                      <TableCell align="right">
                        <strong>{sumNet.toFixed(2)}</strong>
                      </TableCell>
                      <TableCell align="right">
                        <strong>{sumTax.toFixed(2)}</strong>
                      </TableCell>
                      <TableCell align="right">
                        <strong>{sumTotal.toFixed(2)}</strong>
                      </TableCell>
                    </TableRow>
                  )
                })()}
              </TableBody>
            </Table>
          </TableContainer>
        }
    </Box>


  ) : (
        // --- LIST VIEW ---
    <Box mt={2}>
      <Typography variant="h5" gutterBottom ml={1}>
        Your Orders
      </Typography>
      <TableContainer component={Paper} elevation={2}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Date &amp; Time</TableCell>
              <TableCell align="right">Total</TableCell>
              <TableCell align="right">Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {orders.map(o => (
              <TableRow
                key={o.id}
                hover
                sx={{ cursor: 'pointer' }}
                onClick={() => setSelected(o.id)}
              >
                <TableCell>
                  {new Date(o.createdAt).toLocaleString(undefined, {
                    year:   'numeric',
                    month:  'short',
                    day:    '2-digit',
                    hour:   '2-digit',
                    minute: '2-digit',
                  })}
                </TableCell>
                <TableCell align="right">
                  €{o.totalPrice.toFixed(2)}
                </TableCell>
                <TableCell align="right">
                  <Chip
                    label={o.status.charAt(0).toUpperCase() + o.status.slice(1)}
                    color={statusColorMap[o.status] ?? 'default'}
                    size="small"
                  />
                </TableCell>
              </TableRow>
            ))}
            {orders.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} align="center" sx={{ py: 4 }}>
                  No orders found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )

}
