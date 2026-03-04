import ReceiptView from './ReceiptView'

export interface ReceiptProps {
  date: string
  businessId: string | null
  company: string
  phoneNumber: string
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