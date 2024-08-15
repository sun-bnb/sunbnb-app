'use client'

import Link from 'next/link'
import { createInventoryItem } from './actions'

export default function Inventory({ siteId, content } : { siteId: string, content: any }) {
  
  return (
    <div className="container mx-auto">
      <div className="mt-6 flex">
        Content
      </div>
    </div>
  )

}