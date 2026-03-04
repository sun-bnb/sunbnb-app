export interface Product {

  id: string

  name: string
  description?: string | null
  imageUrl?: string | null
  price: number
  tax: number
  totalPrice: number

}

export interface Order {

  id: string

  invoiceId?: string | null

  userId?: string | null
  anonId?: string | null
  siteId: string
  
  status : string     

  price: number
  tax: number
  totalPrice: number

  paymentRef?: string | null
  paymentAmount?: number | null

  orderItems: OrderItem[]

}

interface OrderItem {

  id: string

  orderId: string
  productId: string

  quantity: number
  name: string
  price: number
  tax: number
  totalPrice: number

}

export interface Invoice {
  id: string
  totalCharge: number
  totalTax: number
  totalAmount: number
  issuerType?: 'PARTNER' | 'PLATFORM'
  issuerVatNumber?: string | null
  settlementId?: string | null
  invoiceLines: {
    id: string
    description: string | null
    charge: number
    tax: number
    amount: number
  }[]
}
