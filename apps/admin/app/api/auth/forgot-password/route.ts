import { NextRequest, NextResponse } from 'next/server'
import { requestPasswordReset } from '@repo/data/password-reset'
import { rateLimit } from '@repo/data/rate-limit'

export async function POST(req: NextRequest) {
  try {
    // Rate-limit by IP to prevent mass email enumeration
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const rl = rateLimit(`forgot-password:${ip}`, { maxAttempts: 5, windowMs: 15 * 60 * 1000 })
    if (!rl.allowed) {
      // Return success-like response to avoid leaking rate limit to attackers
      return NextResponse.json({ ok: true })
    }

    const { email } = await req.json()

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ ok: false, error: 'Email is required' }, { status: 400 })
    }

    const origin = req.headers.get('origin') || req.nextUrl.origin
    const result = await requestPasswordReset(email.toLowerCase().trim(), origin)
    return NextResponse.json(result)
  } catch (error) {
    console.error('Forgot password error:', error)
    return NextResponse.json({ ok: false, error: 'Something went wrong' }, { status: 500 })
  }
}
