'use client'

import { SharedMapProvider } from './SharedMapContext'
import InventoryView from './view'

export default async function InventoryPage() {

  return (
    <SharedMapProvider>
      <InventoryView />
    </SharedMapProvider>
  )

}