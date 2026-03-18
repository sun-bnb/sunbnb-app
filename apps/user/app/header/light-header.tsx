import Link from 'next/link'
import Image from 'next/image'
import { useSession } from 'next-auth/react'
import { useState } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'


import * as React from 'react'
import { useTranslations, useLocale } from 'next-intl'
import Paper from '@mui/material/Paper'
import IconButton from '@mui/material/IconButton'
import AccountCircleIcon from '@mui/icons-material/AccountCircle'

import { RootState } from '@/store/store'
import { useSelector } from 'react-redux'
import { useGetAutocompleteSuggestionsQuery } from '@/store/features/autocomplete/autocompleteSlice'
import { useRouter } from 'next/navigation'

import logoIcon from './logo.svg'

const LOCALES = [
  { code: 'en', label: 'EN', flag: '🇬🇧' },
  { code: 'fi', label: 'FI', flag: '🇫🇮' },
  { code: 'es', label: 'ES', flag: '🇪🇸' },
]

function LanguageSwitcher() {
  const locale = useLocale()
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const switchLocale = (code: string) => {
    document.cookie = `NEXT_LOCALE=${code};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`
    setOpen(false)
    router.refresh()
  }

  const current = LOCALES.find(l => l.code === locale) ?? LOCALES[0]!

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1.5 rounded-full text-xs font-semibold text-gray-500 hover:bg-black/5 transition-colors"
      >
        <span>{current.flag}</span>
        <span>{current.label}</span>
        <svg className={`w-3 h-3 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 bg-white rounded-xl shadow-lg border border-gray-100 py-1 min-w-[90px]">
            {LOCALES.map(l => (
              <button
                key={l.code}
                type="button"
                onClick={() => switchLocale(l.code)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-gray-50 ${
                  l.code === locale ? 'text-gray-900 font-semibold' : 'text-gray-500'
                }`}
              >
                <span>{l.flag}</span>
                <span>{l.label}</span>
                {l.code === locale && (
                  <svg className="w-3 h-3 text-brand-cyan ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

const userNavigation = [
  { name: 'Profile', href: '/account' },
  { name: 'Reservations', href: '/reservations' },
  { name: 'Privacy', href: '/privacy' },
  { name: 'Sign out', href: '/api/auth/signout' },
]

export default function CustomizedInputBase() {

  const { data: session, status } = useSession()

  const loggedIn = !!(session?.user?.id)

  const router = useRouter()

  const [ isMenuOpen, setIsMenuOpen ] = useState<boolean>(false)

  const searchState = useSelector((state: RootState) => state.search)
  const { searchText, selectedPlace } = searchState

  const { data: suggestions } = useGetAutocompleteSuggestionsQuery(searchText, {
    skip: searchText.length < 3, // Skip the query if inputValue is empty
  })

  const t = useTranslations('HomePage')

  const showSuggestions = (suggestions || []).length > 0 && searchText.length > 2

  return (
    <div className="bg-cream">
      <Paper
        component="form"
        elevation={0}
        sx={{ p: '4px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', maxWidth: '1280px', mx: 'auto', backgroundColor: '#fff5e1' }}
      >
        <Link href="/">
          <IconButton sx={{ p: '8px', marginTop: '-2px' }} aria-label="menu">
            <Image src={logoIcon} alt="logo" width={30} height={30} />
          </IconButton>
        </Link>

        <div className="flex items-center gap-1 pr-1">
          <LanguageSwitcher />
          <div className="p-[8px]">
            <Menu as="div" className="">
              <div>
                {
                  loggedIn ? (
                    <MenuButton className="relative flex max-w-xs items-center rounded-full bg-gray-100 text-sm hover:outline-none hover:ring-2 hover:ring-offset-gray-100"
                      onClick={() => setIsMenuOpen(!isMenuOpen)}>
                      <img alt="" src={session?.user?.image!} className="h-8 w-8 rounded-full" />
                    </MenuButton>
                  ) : (
                    <div style={{ width: '24px', height: '24px' }}>
                      <AccountCircleIcon style={{ width: '32px', height: '32px', marginTop: '-5px' }} onClick={() => {
                        router.push('/api/auth/signin')
                      }}/>
                    </div>
                  )
                }
              </div>
            </Menu>
          </div>
        </div>
      </Paper>
      {
        isMenuOpen && (
          <div className="flex flex-wrap justify-center pb-4 gap-1.5">
            {
              userNavigation.map((item, index) => {
                return (
                  <div className="max-w-[300px] truncate font-semibold px-3 py-0.5 rounded-full bg-[#363636] text-cream text-sm" key={'userNavigation-'+index} 
                    onClick={() => {
                      setIsMenuOpen(false)
                      router.push(item.href)
                    }}>
                    { t(item.name) }
                  </div>
                )
              })
            }
          </div>
        )
      }
    </div>
  )
}