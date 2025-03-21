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
import Glow from './Glow'

import { setSearchState, setSelectedPlace } from '@/store/features/search/searchSlice'
import { RootState } from '@/store/store'
import { useDispatch, useSelector } from 'react-redux'
import { useGetAutocompleteSuggestionsQuery } from '@/store/features/autocomplete/autocompleteSlice'
import { useRouter } from 'next/navigation'

import logoIcon from './logo.svg'

const userNavigation = [
  { name: 'Profile', href: '/account' },
  { name: 'Reservations', href: '/reservations' },
  { name: 'Sign out', href: '/api/auth/signout' },
]

export default function CustomizedInputBase() {

  const { data: session, status } = useSession()

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

  return (
    <div className="bg-[#fff5e1]">
      <Paper
        component="form"
        elevation={0}
        sx={{ p: '2px 4px', display: 'flex', alignItems: 'center', width: 'full', backgroundColor: '#fff5e1' }}
      >
        <Link href="/">
          <IconButton sx={{ p: '8px', marginTop: '-2px' }} aria-label="menu">
            <Image src={logoIcon} alt="logo" width={30} height={30} />
          </IconButton>
        </Link>
        {

          !selectedPlace ? (
            <>
              <InputBase
                sx={{ ml: 1, flex: 1 }}
                placeholder="Find your place under the sun"
                inputProps={{ 'aria-label': 'search google maps' }}
                value={searchText}
                onChange={(e) => {
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
        
        <div className="p-[10px]">
          <Menu as="div" className="">
            <div>
              <MenuButton className="relative flex max-w-xs items-center rounded-full bg-gray-100 text-sm hover:outline-none hover:ring-2 hover:ring-offset-gray-100"
                onClick={() => setIsMenuOpen(!isMenuOpen)}>
                <img alt="" src={session?.user?.image!} className="h-8 w-8 rounded-full" />
              </MenuButton>
            </div>
          </Menu>
        </div>
      </Paper>
      {
        isMenuOpen && (
          <div className="flex flex-wrap justify-center -mt-3 pb-4">
            {
              userNavigation.map((item, index) => {
                return (
                  <div className="max-w-[300px] truncate font-bold mr-1 ml-1 mt-1 px-2 border-yellow-200 border rounded-md bg-gray-600 text-yellow-200" key={'userNavigation-'+index} 
                    onClick={() => {
                      console.log('Selected userNavigation', item)
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
        !selectedPlace && (
          <div className="flex flex-wrap justify-center -mt-1 pb-4">
            {
              ((searchText.length > 2 && suggestions) || []).map((suggestion, index) => {
                return (
                  <div
                    key={'suggestion-'+index}
                    className="max-w-[300px] truncate font-bold mr-1 ml-1 mt-1 px-2 rounded-md bg-[#00cef1] text-[#203030] animate-bubble-up"
                    style={{ animationDelay: `${index * 0.1}s` }}
                    onClick={() => {
                      console.log('Selected suggestion', suggestion)
                      dispatch(setSelectedPlace({ 
                        selectedPlace: { 
                          placeId: suggestion.place_id,
                          placeName: suggestion.description,
                          mainText: suggestion.structured_formatting.main_text
                        }
                      }))
                      router.push('/')
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

      
      <div className="-mt-4">
        <Glow state={searchText} />
      </div>
    </div>
  );
}