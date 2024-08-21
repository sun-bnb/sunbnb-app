'use client'

import Link from 'next/link'
import { signOut } from 'next-auth/react'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'

const Sidebar = () => {

  const pathname = usePathname()
  const { data: session, status } = useSession()

  const menuItems = [
    { name: 'Home', path: '/' },
    { name: 'Account', path: '/account' },
    { name: 'Inventory', path: '/inventory' }
  ]

  return (
    <div className="h-screen w-64 text-gray-600 fixed">
      <nav className="mt-6">
        {
          menuItems.map((item) => (
            <div
              key={item.path}
              className={`px-4 py-2 hover:text-black ${
                pathname === item.path ? 'text-black font-bold' : ''
              }`}
            >
              <Link href={item.path}>{item.name}</Link>
            </div>
          ))
        }
        <div className="mt-4 px-4 py-2 hover:text-black">
          <button onClick={() => signOut()}>
            <b>Sign out</b>
          </button>
        </div>
      </nav>
    </div>
  )
}

export default Sidebar
