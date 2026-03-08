import ReceiptView from './ReceiptView'

export interface InvoiceSection {
  invoiceNumber: string | null
  merchantName: string
  merchantVatId: string | null
  merchantAddress: string | null
  merchantPhone: string | null
  lines: {
    description: string | null
    charge: number
    vatRate: number | null
    vat: number
    total: number
  }[]
  subtotalCharge: number
  subtotalVat: number
  subtotalAmount: number
}

export interface ReceiptProps {
  date: string
  siteName: string | null
  reservationDate: string | null
  seatNumbers: string | null
  partnerSection: InvoiceSection
  platformSection: InvoiceSection | null
  grandTotal: number
}

export function formatCurrency(value: number): string {
  return value.toFixed(2)
}

export default function ReceiptPage({ 
  receipt
} : { 
  receipt: ReceiptProps
}) {
  return (
    <div className="App">
      <ReceiptView receipt={receipt} />
    </div>
  )
}
