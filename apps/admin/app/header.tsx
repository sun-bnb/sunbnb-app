'use client'

import Link from 'next/link'
import Image from 'next/image'
import sunbnbLogo from '@/app/sunbnb-logo.svg'
import { useSession, signOut } from 'next-auth/react'
import { usePathname } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'

const navItems = [
  { label: 'Settlements', href: '/settlements' },
  { label: 'Sites', href: '/sites' },
  { label: 'Fees', href: '/fees' },
  { label: 'Platform', href: '/platform' },
]

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname.startsWith(href)
}

export default function Header() {
  const { data: session } = useSession()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  const initials = session?.user?.name
    ? session.user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : session?.user?.email?.[0]?.toUpperCase() || '?'

  return (
    <header className="sticky top-0 z-40 bg-gray-950 border-b border-gray-800">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">

        {/* Left: Logo + Nav */}
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2 flex-shrink-0">
            <Image alt="Sunbnb" src={sunbnbLogo} className="w-7 h-7 brightness-200" />
            <span className="text-sm font-bold text-gray-300 hidden md:inline">
              sunbnb <span className="text-purple-400 font-semibold">admin</span>
            </span>
          </Link>

          <nav className="flex items-center gap-1">
            {navItems.map(item => {
              const active = isActive(pathname, item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                    active
                      ? 'text-purple-400 font-semibold bg-purple-400/10'
                      : 'text-gray-500 font-medium hover:text-gray-300 hover:bg-gray-800/50'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>

        {/* Right: User menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 rounded-full p-0.5 hover:ring-2 hover:ring-gray-700 transition-all"
          >
            {session?.user?.image ? (
              <img
                src={session.user.image}
                alt=""
                className="w-8 h-8 rounded-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-purple-400/20 text-purple-400 flex items-center justify-center text-xs font-semibold">
                {initials}
              </div>
            )}
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-48 bg-gray-900 rounded-xl border border-gray-800 shadow-lg py-1 z-50">
              <div className="px-4 py-2.5 border-b border-gray-800">
                <p className="text-sm font-medium text-gray-200 truncate">
                  {session?.user?.name || 'Admin'}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {session?.user?.email}
                </p>
              </div>

              <button
                onClick={() => { setMenuOpen(false); signOut() }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
              >
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15m-3 0-3-3m0 0 3-3m-3 3H15" />
                </svg>
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
