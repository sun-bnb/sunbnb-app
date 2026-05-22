/**
 * Cron: Send Table-Reservation Reminder Emails
 *
 * Emails a reminder for confirmed restaurant reservations starting within the
 * next 24h that haven't been reminded yet, then stamps `reminderSentAt`.
 * Designed for Vercel Cron / an external scheduler (e.g. daily). SMS reminders
 * are a future addition (pending an SMS provider).
 *
 * Protected by CRON_SECRET. Gated by the `restaurants` feature flag.
 *
 * GET /api/cron/table-reminders
 */

import { NextResponse } from 'next/server'
import {
  listReservationsNeedingReminder,
  markReminderSent,
  reminderEmailHtml,
} from '@repo/table-reservations-core'
import { sendEmail } from '@repo/data/email'
import { isFlagEnabled } from '@/app/flags'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!(await isFlagEnabled('restaurants'))) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 'flag_off' })
  }

  try {
    const due = await listReservationsNeedingReminder(24)
    let sent = 0
    for (const r of due) {
      try {
        await sendEmail({
          to: r.guestEmail,
          subject: `Reminder: your reservation at ${r.restaurant.name}`,
          html: reminderEmailHtml(r, r.restaurant, null),
        })
        await markReminderSent(r.id)
        sent++
      } catch (err) {
        // Don't let one failure abort the batch; it'll retry next run.
        console.error('[cron/table-reminders] send failed', r.id, err)
      }
    }
    return NextResponse.json({ ok: true, sent, due: due.length })
  } catch (err) {
    console.error('[cron/table-reminders] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
