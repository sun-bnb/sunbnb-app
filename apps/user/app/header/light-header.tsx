import Link from 'next/link'
import Image from 'next/image'
import { useSession } from 'next-auth/react'
import { useState } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'


import * as React from 'react'
import { useTranslations } from 'next-intl'
import Paper from '@mui/material/Paper'
import IconButton from '@mui/material/IconButton'
import AccountCircleIcon from '@mui/icons-material/AccountCircle'

import { RootState } from '@/store/store'
import { useSelector } from 'react-redux'
import { useGetAutocompleteSuggestionsQuery } from '@/store/features/autocomplete/autocompleteSlice'
import { useRouter } from 'next/navigation'

import logoIcon from './logo.svg'

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
    <div className="bg-[#fff5e1]">
      <Paper
        component="form"
        elevation={0}
        sx={{ p: '2px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: 'full', backgroundColor: '#fff5e1' }}
      >
        <Link href="/">
          <IconButton sx={{ p: '8px', marginTop: '-2px' }} aria-label="menu">
            <Image src={logoIcon} alt="logo" width={30} height={30} />
          </IconButton>
        </Link>
        
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
      </Paper>
      {
        isMenuOpen && (
          <div className="flex flex-wrap justify-center pb-4">
            {
              userNavigation.map((item, index) => {
                return (
                  <div className="max-w-[300px] truncate font-bold mr-1 ml-1 mt-1 px-2 rounded-md bg-[#303030] text-[#fff5e1]" key={'userNavigation-'+index} 
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