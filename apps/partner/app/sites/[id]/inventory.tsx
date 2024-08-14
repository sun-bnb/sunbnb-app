'use client'

import Link from 'next/link'

export default function Inventory({ inventory } : { inventory: { id: string }[] }) {
  
  return (
    <div className="container mx-auto px-4">
      <div>
        {
          inventory.map(item => (
            <div key={item.id}>
              Item {item.id}
            </div>
          ))
        }
      </div>
      <div>
        <Link href="/sites/create">+ Add item</Link>
      </div>
    </div>
  )

}