'use client'

import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import AccountCircleIcon from '@mui/icons-material/AccountCircle'
import EventNoteIcon from '@mui/icons-material/EventNote'
import type { SiteViewBrand } from '@/app/sites/[id]/view'

export default function BrandHeader({ brand }: { brand: SiteViewBrand }) {

  const { data: session } = useSession()
  const router = useRouter()
  const loggedIn = !!(session?.user?.id)
  const fgColor = brand.fgColor || '#111827'

  if (!loggedIn) return null

  return (
    <div className="flex items-center justify-end px-4 py-4">
      <button
        onClick={() => router.push('/account')}
        className="flex items-center hover:opacity-80 transition-opacity"
      >
        {session?.user?.image ? (
          <img
            alt=""
            src={session.user.image}
            className="h-8 w-8 rounded-full ring-2 ring-white/60"
          />
        ) : (
          <AccountCircleIcon style={{ fontSize: 32, color: 'white', filter: 'drop-shadow(0 0 2px rgba(255,255,255,0.5))' }} />
        )}
      </button>
    </div>
  )
}
