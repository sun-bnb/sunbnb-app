import { NextRequest, NextResponse } from 'next/server'
import { requestPasswordReset } from '@repo/data/password-reset'

export async function POST(req: NextRequest) {
  try {
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
