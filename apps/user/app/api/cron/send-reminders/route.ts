/**
 * Cron: Send Reminder Emails
 *
 * Sends reminder emails for today's reservations that haven't been reminded yet.
 * Designed to be called by Vercel Cron or an external scheduler (e.g., every morning at 7 AM).
 *
 * Protected by CRON_SECRET to prevent unauthorized access.
 *
 * GET /api/cron/send-reminders
 */

import { NextResponse } from 'next/server'
import { sendDueReminders } from '@repo/data/reservation-emails'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // Authenticate cron requests
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const sent = await sendDueReminders()
    return NextResponse.json({ ok: true, sent })
  } catch (err) {
    console.error('[cron/send-reminders] Error:', err)
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 }
    )
  }
}
