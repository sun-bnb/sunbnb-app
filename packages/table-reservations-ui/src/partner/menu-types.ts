export interface MenuItemFormValues {
  name: string
  description: string
  // Gross (VAT-inclusive) price + VAT %. The net price is derived server-side.
  totalPrice: number
  tax: number
  category: string
  imageUrl: string | null
  imageFile: File | null
}

export interface MenuItemSaveResult {
  status: 'ok' | 'error'
  errors?: string[]
}
