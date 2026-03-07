import ReceiptView from './ReceiptView'

export interface ReceiptProps {
  date: string
  businessId: string | null
  company: string
  companyAddress: string | null
  phoneNumber: string
  siteName: string | null
  reservationDate: string | null
  seatNumbers: string | null
  totalCharge: number
  totalVat: number
  totalAmount: number
  invoiceLines: {
    description: string | null
    charge: number
    vat: number
    total: number
  }[]
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