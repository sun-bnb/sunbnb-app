export interface Product {
  id: string
  name: string
  description?: string | null
  imageUrl?: string | null
  price: number
  tax: number
  totalPrice: number
}