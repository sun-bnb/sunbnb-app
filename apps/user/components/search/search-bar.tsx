import { useSession } from 'next-auth/react'
import { useState } from 'react'


import * as React from 'react'
import { useTranslations } from 'next-intl'
import InputBase from '@mui/material/InputBase'
import IconButton from '@mui/material/IconButton'
import SearchIcon from '@mui/icons-material/Search'

import { setSearchState, setSelectedPlace } from '@/store/features/search/searchSlice'
import { RootState } from '@/store/store'
import { useDispatch, useSelector } from 'react-redux'
import { useGetAutocompleteSuggestionsQuery } from '@/store/features/autocomplete/autocompleteSlice'
import { useRouter } from 'next/navigation'

export default function SearchBar() {

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

  const showSuggestions = (suggestions || []).length > 0 && searchText.length > 2

  return (
    <div className="bg-white">
      <div className="w-full flex rounded-lg border border-gray-200 p-2">
        <InputBase
          fullWidth={true}
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
      </div>
        
      { 
        (!selectedPlace && !isMenuOpen && showSuggestions) && (
          <div className="bg-[#fff5e1] flex flex-wrap justify-center pt-2 pb-4">
            {
              ((searchText.length > 2 && suggestions) || []).map((suggestion, index) => {
                return (
                  <div
                    key={'suggestion-'+index}
                    className="max-w-[300px] truncate font-bold mr-1 ml-1 mt-1 px-2 rounded-md bg-[#00cef1] text-[#fff5e1] animate-bubble-up"
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
  )
}