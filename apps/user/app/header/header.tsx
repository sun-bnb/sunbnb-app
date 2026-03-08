import Link from 'next/link'
import Image from 'next/image'
import { useSession } from 'next-auth/react'
import { useState } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'


import * as React from 'react'
import { useTranslations } from 'next-intl'
import Paper from '@mui/material/Paper'
import InputBase from '@mui/material/InputBase'
import IconButton from '@mui/material/IconButton'
import SearchIcon from '@mui/icons-material/Search'
import AccountCircleIcon from '@mui/icons-material/AccountCircle'

import Glow from './Glow'

import { setSearchState, setSelectedPlace } from '@/store/features/search/searchSlice'
import { RootState } from '@/store/store'
import { useDispatch, useSelector } from 'react-redux'
import { useGetAutocompleteSuggestionsQuery } from '@/store/features/autocomplete/autocompleteSlice'
import { useRouter } from 'next/navigation'

import logoIcon from './logo.svg'
import { getEnvLabel } from '@repo/data/env'

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
  const [ inputIntervals, setInputIntervals ] = useState<number[]>([])
  const [ lastInputTime, setLastInputTime ] = useState<number>(0)

  const dispatch = useDispatch();
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
        sx={{ p: '4px 6px', display: 'flex', alignItems: 'center', width: '100%', maxWidth: '1280px', mx: 'auto', backgroundColor: '#fff5e1' }}
      >
        <Link href="/" className="relative">
          <IconButton sx={{ p: '8px', marginTop: '-2px' }} aria-label="menu">
            <Image src={logoIcon} alt="logo" width={30} height={30} />
          </IconButton>
          {getEnvLabel() && (
            <span className="absolute top-0 right-0 translate-x-1/4 -translate-y-1/4 text-[7px] font-extrabold tracking-wide px-1 py-[1px] rounded bg-amber-400 text-amber-900 leading-none whitespace-nowrap shadow-sm pointer-events-none z-10">
              {getEnvLabel()}
            </span>
          )}
        </Link>
        {

          !selectedPlace ? (
            <>
              <InputBase
                sx={{ ml: 1, flex: 1 }}
                placeholder={t('slogan')}
                inputProps={{ 'aria-label': 'search google maps' }}
                value={searchText}
                onChange={(e) => {
                  setIsMenuOpen(false)
                  dispatch(setSearchState({ searchText: e.target.value }))
                  const now = Date.now()
                  inputIntervals.push(now - lastInputTime)
                  if (inputIntervals.length > 5) {
                    inputIntervals.shift()
                  }

                  const sum = inputIntervals.reduce((accumulator, currentValue) => accumulator + currentValue, 0)
                  const average = sum / inputIntervals.length
                  setInputIntervals(inputIntervals)
                  setLastInputTime(now)
                }}
              />
              <IconButton type="button" sx={{ p: '10px' }} aria-label="search">
                <SearchIcon />
              </IconButton>
            </>
          
          ) : (
            <div className="flex flex-grow items-center" onClick={
              () => {
                dispatch(setSearchState({ searchText: '' }))
                dispatch(setSelectedPlace({ selectedPlace: null }))
              }
            }>
              <div className="flex-grow leading-[20px] pl-2">
                { selectedPlace.placeName }
              </div>
              <IconButton type="button" sx={{ p: '10px' }} aria-label="search" >
                <SearchIcon />
              </IconButton>
            </div>
          )

        }
        
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
      <div className="-mt-4">
        <Glow state={searchText} />
      </div>
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
      { 
        (!selectedPlace && !isMenuOpen && showSuggestions) && (
          <div className="flex flex-wrap justify-center -mt-1 pb-4 gap-1.5">
            {
              ((searchText.length > 2 && suggestions) || []).map((suggestion, index) => {
                return (
                  <div
                    key={'suggestion-'+index}
                    className="max-w-[300px] truncate font-semibold px-3 py-0.5 rounded-full bg-brand-cyan text-cream text-sm shadow-soft animate-bubble-up"
                    style={{ animationDelay: `${index * 0.1}s` }}
                    onClick={() => {
                      dispatch(setSelectedPlace({ 
                        selectedPlace: { 
                          placeId: suggestion.place_id,
                          placeName: suggestion.description,
                          mainText: suggestion.structured_formatting.main_text
                        }
                      }))
                      router.push('/sites')
                    }}
                  >
                    {suggestion.description}
                  </div>
                )
              })
            }
          </div>
        )
      }
    </div>
  );
}