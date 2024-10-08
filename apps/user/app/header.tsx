import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useState } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'


import * as React from 'react'
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

  return (
    <div>
      <Paper
        component="form"
        elevation={0}
        sx={{ p: '2px 4px', display: 'flex', alignItems: 'center', width: 'full' }}
      >
        <Link href="/">
          <IconButton sx={{ p: '10px', marginTop: '-2px' }} aria-label="menu">
            &#x2600;
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
                    {item.name}
                  </div>
                )
              })
            }
          </div>
        )
      }
      { 
        !selectedPlace && (
          <div className="flex flex-wrap justify-center -mt-3 pb-4">
            {
              ((searchText.length > 2 && suggestions) || []).map((suggestion, index) => {
                return (
                  <div className="max-w-[300px] truncate font-bold mr-1 ml-1 mt-1 px-2 border-gray-600 border rounded-md bg-yellow-200 text-gray-600" key={'suggestion-'+index} 
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
                    }}>
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