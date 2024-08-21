import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useRouter, usePathname } from 'next/navigation'
import { ReactNode, useEffect, useState } from "react"
import { Disclosure, Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import TextField from '@mui/material/TextField'


import * as React from 'react';
import Paper from '@mui/material/Paper';
import InputBase from '@mui/material/InputBase';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import MenuIcon from '@mui/icons-material/Menu';
import SearchIcon from '@mui/icons-material/Search';
import DirectionsIcon from '@mui/icons-material/Directions';

const userNavigation = [
  { name: 'Your Profile', href: '#' },
  { name: 'Settings', href: '#' },
  { name: 'Sign out', href: '#' },
]

export default function CustomizedInputBase() {

  const { data: session, status } = useSession()
  const [ searchText, setSearchText ] = useState<string>('')

  return (
    <Paper
      component="form"
      sx={{ p: '2px 4px', display: 'flex', alignItems: 'center', width: 'full' }}
    >
      <Link href="/">
        <IconButton sx={{ p: '10px', marginTop: '-2px' }} aria-label="menu">
          &#x2600;
        </IconButton>
      </Link>
      <InputBase
        sx={{ ml: 1, flex: 1 }}
        placeholder="Search places under the sun"
        inputProps={{ 'aria-label': 'search google maps' }}
      />
      <IconButton type="button" sx={{ p: '10px' }} aria-label="search">
        <SearchIcon />
      </IconButton>
        <div className="p-[10px]">
          <Menu as="div" className="">
            <div>
              <MenuButton className="relative flex max-w-xs items-center rounded-full bg-gray-100 text-sm hover:outline-none hover:ring-2 hover:ring-offset-gray-100">
                <span className="absolute -inset-1.5" />
                <span className="sr-only">Open user menu</span>
                <img alt="" src={session?.user?.image!} className="h-8 w-8 rounded-full" />
              </MenuButton>
            </div>
            <MenuItems
              transition
              className="absolute right-0 z-10 mt-2 w-48 origin-top-right rounded-md bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5 transition focus:outline-none data-[closed]:scale-95 data-[closed]:transform data-[closed]:opacity-0 data-[enter]:duration-100 data-[leave]:duration-75 data-[enter]:ease-out data-[leave]:ease-in"
            >
              {userNavigation.map((item) => (
                <MenuItem key={item.name}>
                  <Link
                    href={item.href}
                    className="block px-4 py-2 text-sm text-gray-700 data-[focus]:bg-gray-100"
                  >
                    {item.name}
                  </Link>
                </MenuItem>
              ))}
            </MenuItems>
          </Menu>
        </div>
    </Paper>
  );
}