'use client'

import { ThemeProvider, createTheme } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { ReactNode } from 'react'

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#a78bfa', // purple-400
    },
    background: {
      default: '#030712', // gray-950
      paper: '#111827',   // gray-900
    },
  },
  typography: {
    fontFamily: 'var(--font-geist-sans), sans-serif',
    fontSize: 13,
  },
  components: {
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundImage: 'none',
          border: '1px solid rgb(31 41 55)', // gray-800
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none' as const,
          fontWeight: 500,
        },
      },
    },
  },
})

export default function MuiThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline enableColorScheme />
      {children}
    </ThemeProvider>
  )
}
