export interface MenuItemFormValues {
  name: string
  description: string
  price: number
  category: string
  imageUrl: string | null
  imageFile: File | null
}

export interface MenuItemSaveResult {
  status: 'ok' | 'error'
  errors?: string[]
}
