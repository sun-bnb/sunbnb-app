import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useState } from "react"


import * as React from 'react'
import Paper from '@mui/material/Paper'
import IconButton from '@mui/material/IconButton'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Tooltip from '@mui/material/Tooltip'
import Avatar from '@mui/material/Avatar'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Typography from '@mui/material/Typography'


import { useRouter } from 'next/navigation'

const userNavigation = [
  { name: 'Account', href: '/account' },
  { name: 'Sign out', href: '/api/auth/signout' },
]

export default function CustomizedInputBase() {

  const { data: session, status } = useSession()
  const router = useRouter()
  const [ isMenuOpen, setIsMenuOpen ] = useState<boolean>(false)

  const [anchorElNav, setAnchorElNav] = React.useState<null | HTMLElement>(null);
  const [anchorElUser, setAnchorElUser] = React.useState<null | HTMLElement>(null);

  const handleOpenNavMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorElNav(event.currentTarget);
  };
  const handleOpenUserMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorElUser(event.currentTarget);
  };

  const handleCloseNavMenu = () => {
    setAnchorElNav(null);
  };

  const handleCloseUserMenu = () => {
    setAnchorElUser(null);
  };

  return (
    <div className="w-full">
      <div className="w-full flex items-center justify-between">
        <div className="flex items-center">
          <Link href="/">
            <span style={{ fontSize: '40px', marginLeft: '10px' }}>
              &#x2600;
            </span>
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
          <Box sx={{ flexGrow: 0 }}>
            <Tooltip title="Open settings">
              <IconButton onClick={handleOpenUserMenu} sx={{ p: 0 }}>
                <Avatar alt="Remy Sharp" src={session?.user?.image!}  />
              </IconButton>
            </Tooltip>
            <Menu
              sx={{ mt: '45px' }}
              id="menu-appbar"
              anchorEl={anchorElUser}
              anchorOrigin={{
                vertical: 'top',
                horizontal: 'right',
              }}
              keepMounted
              transformOrigin={{
                vertical: 'top',
                horizontal: 'right',
              }}
              open={Boolean(anchorElUser)}
              onClose={handleCloseUserMenu}
            >
              {userNavigation.map((navItem) => (
                <MenuItem key={navItem.href} onClick={handleCloseUserMenu}>
                  <Link href={navItem.href}>
                    <Typography sx={{ textAlign: 'center' }}>{navItem.name}</Typography>
                  </Link>
                </MenuItem>
              ))}
            </Menu>
          </Box>
        </div>
      </div>
    </div>
  )
}