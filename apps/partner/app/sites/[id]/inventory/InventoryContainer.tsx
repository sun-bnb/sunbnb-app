'use client'

import { SharedMapProvider } from './SharedMapContext'
import InventoryView from './view'

export default function InventoryContainer() {

  return (
    <SharedMapProvider>
      <InventoryView />
    </SharedMapProvider>
  )

}