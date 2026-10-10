'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { flushPendingLogin } from './track'

/** Emits GA4 `sign_up` (new account) or `login` once a sign-in started in this tab has produced a session. Renders nothing. */
export default function AuthAnalytics() {
  const { data: session, status } = useSession()
  useEffect(() => {
    if (status === 'authenticated') flushPendingLogin((session?.user as { isNewUser?: boolean } | undefined)?.isNewUser)
  }, [status])
  return null
}
