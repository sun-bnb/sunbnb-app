import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useState } from "react"
import { Menu, MenuButton } from '@headlessui/react'


import * as React from 'react'
import Paper from '@mui/material/Paper'
import IconButton from '@mui/material/IconButton'

import { useRouter } from 'next/navigation'

const userNavigation = [
  { name: 'Account', href: '/account' },
  { name: 'Sign out', href: '/api/auth/signout' },
]

export default function CustomizedInputBase() {

  const { data: session, status } = useSession()
  const router = useRouter()
  const [ isMenuOpen, setIsMenuOpen ] = useState<boolean>(false)

  return (
    <div className="w-full">
      <div className="w-full flex items-center justify-between">
        <div className="flex items-center">
          <Link href="/">
            <IconButton sx={{ p: '10px', marginTop: '-2px' }} aria-label="menu">
              &#x2600;
            </IconButton>
          </Link>
          <div className="flex ml-2">
            <div className="ml-2 mr-2 font-bold">
              <Link href="/sites">Sites</Link>
            </div>
            <div className="ml-2 mr-2 font-bold">
              <Link href="/calendar">Calendar</Link>
            </div>
          </div>
        </div>
        <div className="p-[10px]">
          <Menu as="div" className="">
            <div className="relative">
              <MenuButton className="relative flex max-w-xs items-center rounded-full bg-gray-100 text-sm hover:outline-none hover:ring-2 hover:ring-offset-gray-100"
                onClick={() => setIsMenuOpen(!isMenuOpen)}>
                <img alt="" src={session?.user?.image!} className="h-8 w-8 rounded-full" />
              </MenuButton>
              {
                isMenuOpen && (
                  <div className="flex flex-wrap justify-center absolute top-[32px] right-[36px]">
                    <Paper className="pt-2 pb-2">
                      {
                        userNavigation.map((item, index) => {
                          return (
                            <div className="max-w-[300px] truncate mr-1 ml-1 mt-1 px-2" key={'userNavigation-'+index} 
                              onClick={() => {
                                console.log('Selected userNavigation', item)
                                router.push(item.href)
                              }}>
                              {item.name}
                            </div>
                          )
                        })
                      }
                    </Paper>
                  </div>
                )
              }
            </div>
          </Menu>
        </div>
      </div>
    </div>
  )
}