import { NextRequest, NextResponse } from 'next/server'
import { AuthError } from 'next-auth'
import { signIn } from '@/app/auth'

/**
 * Accepts a signed impersonation token from the admin app and starts a
 * NextAuth session as the target user. The token is single-use (replay
 * protection is enforced by `impersonation_log.token_id` uniqueness inside
 * `consumeImpersonationToken`).
 *
 * On success, NextAuth's `signIn` sets the session cookie and triggers a
 * `NEXT_REDIRECT` to `/`. We rethrow that so Next.js converts it into a 302
 * with the cookies attached.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.redirect(new URL('/sign-in?error=missing_token', request.url))
  }
  try {
    await signIn('impersonation', { token, redirectTo: '/' })
    // signIn redirects on success, so this is unreachable in practice.
    return NextResponse.redirect(new URL('/', request.url))
  } catch (err) {
    if (err instanceof AuthError) {
      // NextAuth wraps the underlying ImpersonationError in `cause`. Surface
      // the code so misconfigurations (wrong AUTH_SECRET, expired token,
      // wrong app, replay) are visible without grepping server logs.
      const cause = err.cause as
        | { err?: { code?: string; message?: string }; code?: string; message?: string }
        | undefined
      const code = cause?.err?.code ?? cause?.code ?? 'unknown'
      console.error('[impersonate] failed', {
        type: err.type,
        code,
        message: cause?.err?.message ?? cause?.message ?? err.message,
      })
      return NextResponse.redirect(
        new URL(
          `/sign-in?error=impersonation_failed&reason=${encodeURIComponent(code)}`,
          request.url,
        ),
      )
    }
    // NEXT_REDIRECT (success) — let the framework handle it.
    throw err
  }
}
