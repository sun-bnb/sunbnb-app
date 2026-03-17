import { NextRequest, NextResponse } from 'next/server'
import { resetPassword } from '@repo/data/password-reset'
import { rateLimit } from '@repo/data/rate-limit'

export async function POST(req: NextRequest) {
  try {
    // Rate-limit by IP to prevent brute-force token guessing
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const rl = rateLimit(`reset-password:${ip}`, { maxAttempts: 5, windowMs: 15 * 60 * 1000 })
    if (!rl.allowed) {
      return NextResponse.json({ ok: false, error: 'Too many attempts. Please try again later.' }, { status: 429 })
    }

    const { token, password } = await req.json()

    if (!token || typeof token !== 'string' || token.length > 256) {
      return NextResponse.json({ ok: false, error: 'Invalid reset link' }, { status: 400 })
    }
    if (!password || typeof password !== 'string' || password.length > 128) {
      return NextResponse.json({ ok: false, error: 'Invalid password' }, { status: 400 })
    }
    if (password.length < 8 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      return NextResponse.json({ ok: false, error: 'Password must be at least 8 characters with uppercase, lowercase, and a number' }, { status: 400 })
    }

    const result = await resetPassword(token, password)
    return NextResponse.json(result, { status: result.ok ? 200 : 400 })
  } catch (error) {
    console.error('Reset password error:', error)
    return NextResponse.json({ ok: false, error: 'Something went wrong' }, { status: 500 })
  }
}
