'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useSession, signOut } from 'next-auth/react'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useFlag } from '@repo/ui/flags'
import sunbnbLogo from '@/app/sunbnb-logo.svg'
import { getEnvLabel } from '@repo/data/env'
import { setLocale } from '@/app/locale/actions'

const LOCALES = [
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
  { code: 'fi', label: 'FI' },
]

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname.startsWith(href)
}

export default function Header() {
  const { data: session } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const t = useTranslations('Header')
  const currentLocale = useLocale()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const restaurantsEnabled = useFlag('restaurants')

  const navItems = [
    { label: t('dashboard'), href: '/' },
    { label: t('frontdesk'), href: '/frontdesk' },
    { label: t('sites'), href: '/sites' },
    ...(restaurantsEnabled ? [{ label: t('restaurants'), href: '/restaurants' }] : []),
    { label: t('calendar'), href: '/calendar' },
    { label: t('security'), href: '/security' },
  ]

  // Close menu on outside click
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
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">

        {/* Left: Logo + Nav */}
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2 flex-shrink-0">
            <span className="relative">
              <Image alt="Sunbnb" src={sunbnbLogo} className="w-8 h-8" />
              {getEnvLabel() && (
                <span className="absolute top-0 right-0 translate-x-1/4 -translate-y-1/4 text-[7px] font-extrabold tracking-wide px-1 py-[1px] rounded bg-amber-400 text-amber-900 leading-none whitespace-nowrap shadow-sm pointer-events-none z-10">
                  {getEnvLabel()}
                </span>
              )}
            </span>
            <span className="text-sm font-bold text-gray-900 hidden md:inline">sunbnb</span>
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
                      ? 'text-gray-900 font-semibold bg-gray-100'
                      : 'text-gray-500 font-medium hover:text-gray-900 hover:bg-gray-50'
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
            className="flex items-center gap-2 rounded-full p-0.5 hover:ring-2 hover:ring-gray-200 transition-all"
          >
            {session?.user?.image ? (
              <img
                src={session.user.image}
                alt=""
                className="w-8 h-8 rounded-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-semibold">
                {initials}
              </div>
            )}
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl border border-gray-200 shadow-lg py-1 z-50">
              {/* User info */}
              <div className="px-4 py-2.5 border-b border-gray-100">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {session?.user?.name || 'Partner'}
                </p>
                <p className="text-xs text-gray-400 truncate">
                  {session?.user?.email}
                </p>
              </div>

              <Link
                href="/account"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                </svg>
                {t('account')}
              </Link>

              <Link
                href="/account/subscription"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
                </svg>
                {t('subscription')}
              </Link>

              {/* Language switcher */}
              <div className="px-4 py-2 border-t border-gray-100">
                <p className="text-xs text-gray-400 mb-1.5">{t('language')}</p>
                <div className="flex gap-1">
                  {LOCALES.map(loc => (
                    <button
                      key={loc.code}
                      onClick={async () => {
                        await setLocale(loc.code)
                        setMenuOpen(false)
                        router.refresh()
                      }}
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                        currentLocale === loc.code
                          ? 'bg-gray-900 text-white'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {loc.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => { setMenuOpen(false); signOut() }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15m-3 0-3-3m0 0 3-3m-3 3H15" />
                </svg>
                {t('signOut')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
