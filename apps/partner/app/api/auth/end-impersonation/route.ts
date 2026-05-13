import { NextRequest, NextResponse } from 'next/server'
import { auth, signOut } from '@/app/auth'
import { endImpersonation } from '@repo/data/impersonation'

/**
 * Mark the current impersonation session as ended (audit) and sign the user
 * out. If there's no impersonation context this is still a regular sign-out.
 */
export async function GET(request: NextRequest) {
  const session = await auth()
  const tokenId = (session?.user as { impersonationTokenId?: string } | undefined)
    ?.impersonationTokenId
  if (tokenId) {
    try {
      await endImpersonation(tokenId)
    } catch {
      // Audit close-out is best-effort; don't block sign-out.
    }
  }
  try {
    await signOut({ redirectTo: '/' })
    return NextResponse.redirect(new URL('/', request.url))
  } catch (err) {
    // signOut throws NEXT_REDIRECT on success — let the framework handle it.
    throw err
  }
}
