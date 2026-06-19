/**
 * Cron: Send Reminder Emails
 *
 * Sends reminder emails for today's reservations and rental bookings that haven't
 * been reminded yet. Designed to be called by Vercel Cron or an external scheduler
 * (e.g., every morning at 7 AM).
 *
 * Protected by CRON_SECRET to prevent unauthorized access.
 *
 * GET /api/cron/send-reminders
 */

import { NextResponse } from 'next/server'
import { sendDueReminders } from '@repo/data/reservation-emails'
import { sendRentalDueReminders } from '@repo/data/rental-emails'

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

  // Run both reminder types independently so a failure in one does not discard
  // the already-sent work of the other. If sunbed reminders throw after 80 sent,
  // we still report those 80 and still attempt rental reminders.
  let sent = 0
  let rentalsSent = 0

  try {
    sent = await sendDueReminders()
  } catch (err) {
    console.error('[cron/send-reminders] Sunbed reminders error:', err)
  }

  try {
    rentalsSent = await sendRentalDueReminders()
  } catch (err) {
    console.error('[cron/send-reminders] Rental reminders error:', err)
  }

  return NextResponse.json({ ok: true, sent, rentalsSent })
}
