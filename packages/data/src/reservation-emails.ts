/**
 * Reservation Email Service
 *
 * Sends transactional emails for the reservation lifecycle:
 *   - Confirmation: immediately after successful payment
 *   - Reminder: morning of the reservation day (triggered by cron)
 *   - Cancellation: when the user or partner cancels
 *
 * All emails are plain HTML — no external template engine needed.
 * Uses the shared sendEmail() utility backed by Resend.
 */

import prisma from '../index'
import { sendEmail } from './email'
import {
  RESERVATION_COMPLETE,
  RESERVATION_PROCESSING,
  OP_EXPECTED,
} from './reservation-status'

// ─── Types ──────────────────────────────────────────────────────────────────

interface ReservationEmailData {
  reservationId: string
  userEmail: string
  siteName: string
  siteId: string
  sunbedNumbers: number[]
  fromDate: Date
  toDate: Date
  amount: number | null
  guestName: string | null
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatCurrency(amount: number | null): string {
  if (amount == null || amount === 0) return 'Free'
  return `€${amount.toFixed(2)}`
}

function dateRange(from: Date, to: Date): string {
  const f = formatDate(from)
  const t = formatDate(to)
  return f === t ? f : `${f} – ${t}`
}

function bedList(numbers: number[]): string {
  if (numbers.length === 0) return '—'
  return numbers.map(n => `#${n}`).join(', ')
}

// ─── Shared Layout ──────────────────────────────────────────────────────────

function emailLayout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f7f7f7;">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">
    <div style="background:#1a1a2e;padding:24px 32px;">
      <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">☀️ Sunbnb</span>
    </div>
    <div style="padding:32px;">
      ${content}
    </div>
    <div style="padding:16px 32px;background:#fafafa;border-top:1px solid #eee;text-align:center;">
      <span style="color:#999;font-size:12px;">Sunbnb — Your spot in the sun</span>
    </div>
  </div>
</body>
</html>`
}

// ─── Template: Confirmation ─────────────────────────────────────────────────

function confirmationHtml(data: ReservationEmailData): string {
  return emailLayout(`
    <h1 style="margin:0 0 8px;font-size:22px;color:#1a1a2e;">Booking Confirmed ✓</h1>
    <p style="color:#666;margin:0 0 24px;font-size:15px;">Your sunbed reservation is all set.</p>

    <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333;">
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888;width:120px;">Location</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-weight:600;">${data.siteName}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888;">Date</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;">${dateRange(data.fromDate, data.toDate)}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888;">Sunbed(s)</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;">${bedList(data.sunbedNumbers)}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;color:#888;">Amount</td>
        <td style="padding:10px 0;font-weight:600;">${formatCurrency(data.amount)}</td>
      </tr>
    </table>

    <div style="margin:28px 0 0;padding:16px;background:#f0fdf4;border-radius:8px;border-left:4px solid #22c55e;">
      <p style="margin:0;font-size:14px;color:#166534;">
        <strong>Reservation ID:</strong> ${data.reservationId.slice(0, 8).toUpperCase()}
      </p>
      <p style="margin:4px 0 0;font-size:13px;color:#15803d;">Show this to the beach attendant when you arrive.</p>
    </div>

    <p style="margin:24px 0 0;font-size:13px;color:#999;">
      Need to cancel? Open your reservations in the Sunbnb app.
    </p>
  `)
}

// ─── Template: Reminder ─────────────────────────────────────────────────────

function reminderHtml(data: ReservationEmailData): string {
  return emailLayout(`
    <h1 style="margin:0 0 8px;font-size:22px;color:#1a1a2e;">Your Beach Day is Today! ☀️</h1>
    <p style="color:#666;margin:0 0 24px;font-size:15px;">Just a friendly reminder about your reservation.</p>

    <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333;">
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888;width:120px;">Location</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-weight:600;">${data.siteName}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888;">Sunbed(s)</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;">${bedList(data.sunbedNumbers)}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;color:#888;">Ref</td>
        <td style="padding:10px 0;font-weight:600;">${data.reservationId.slice(0, 8).toUpperCase()}</td>
      </tr>
    </table>

    <div style="margin:28px 0 0;padding:16px;background:#eff6ff;border-radius:8px;border-left:4px solid #3b82f6;">
      <p style="margin:0;font-size:14px;color:#1e40af;">
        Head to <strong>${data.siteName}</strong> and show your reservation ID to the beach attendant. Enjoy your day!
      </p>
    </div>
  `)
}

// ─── Template: Cancellation ─────────────────────────────────────────────────

function cancellationHtml(data: ReservationEmailData): string {
  return emailLayout(`
    <h1 style="margin:0 0 8px;font-size:22px;color:#1a1a2e;">Reservation Cancelled</h1>
    <p style="color:#666;margin:0 0 24px;font-size:15px;">Your reservation has been cancelled.</p>

    <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333;">
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888;width:120px;">Location</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;">${data.siteName}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888;">Date</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;">${dateRange(data.fromDate, data.toDate)}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;color:#888;">Sunbed(s)</td>
        <td style="padding:10px 0;">${bedList(data.sunbedNumbers)}</td>
      </tr>
    </table>

    <p style="margin:24px 0 0;font-size:14px;color:#666;">
      If a refund was applicable, it will be processed to your original payment method within 5–10 business days.
    </p>
  `)
}

// ─── Public API ─────────────────────────────────────────────────────────────

async function loadReservationEmailData(reservationId: string): Promise<ReservationEmailData | null> {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      user: { select: { email: true, name: true } },
      site: { select: { name: true, id: true } },
      items: { select: { number: true }, orderBy: { number: 'asc' } },
    },
  })

  if (!reservation) return null

  // For anonymous reservations the `user` FK points at the site owner — we must
  // never email the site owner the customer's confirmation. Use guestEmail
  // (collected at marketplace checkout). QR/POS bookings skip email capture,
  // so guestEmail may be null and no confirmation is sent.
  const recipientEmail = reservation.anonId
    ? reservation.guestEmail
    : reservation.user?.email
  if (!recipientEmail) return null

  return {
    reservationId: reservation.id,
    userEmail: recipientEmail,
    siteName: reservation.site?.name ?? 'Beach',
    siteId: reservation.site?.id ?? reservation.siteId,
    sunbedNumbers: reservation.items.map(i => i.number),
    fromDate: reservation.from,
    toDate: reservation.to,
    amount: reservation.paymentAmount,
    guestName: reservation.guestName,
  }
}

/**
 * Send booking confirmation email.
 * Called after processConfirmedReservation completes successfully.
 * Non-throwing: logs errors but does not fail the payment flow.
 */
export async function sendConfirmationEmail(reservationId: string): Promise<void> {
  try {
    const data = await loadReservationEmailData(reservationId)
    if (!data) {
      console.warn(`[sendConfirmationEmail] No data for reservation ${reservationId}`)
      return
    }
    await sendEmail({
      to: data.userEmail,
      subject: `Booking Confirmed — ${data.siteName}`,
      html: confirmationHtml(data),
    })
  } catch (err) {
    console.error(`[sendConfirmationEmail] Failed for ${reservationId}:`, err)
  }
}

/**
 * Send cancellation email.
 * Called after a reservation is cancelled by the user or partner.
 * Non-throwing: logs errors but does not fail the cancellation flow.
 */
export async function sendCancellationEmail(reservationId: string): Promise<void> {
  try {
    const data = await loadReservationEmailData(reservationId)
    if (!data) {
      console.warn(`[sendCancellationEmail] No data for reservation ${reservationId}`)
      return
    }
    await sendEmail({
      to: data.userEmail,
      subject: `Reservation Cancelled — ${data.siteName}`,
      html: cancellationHtml(data),
    })
  } catch (err) {
    console.error(`[sendCancellationEmail] Failed for ${reservationId}:`, err)
  }
}

/**
 * Send reminder emails for today's reservations that haven't been reminded yet.
 * Designed to be called from a cron job (e.g., every morning at 7 AM).
 *
 * Targets reservations where:
 *   - operationalStatus = 'expected' (not yet checked in)
 *   - status is an active booking (not cancelled)
 *   - from date is today
 *   - reminderSentAt is null
 *
 * Returns the count of reminders sent.
 */
export async function sendDueReminders(): Promise<number> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const dueReservations = await prisma.reservation.findMany({
    where: {
      operationalStatus: OP_EXPECTED,
      status: { in: [RESERVATION_COMPLETE, RESERVATION_PROCESSING] },
      from: { gte: today, lt: tomorrow },
      reminderSentAt: null,
    },
    include: {
      user: { select: { email: true, name: true } },
      site: { select: { name: true, id: true } },
      items: { select: { number: true }, orderBy: { number: 'asc' } },
    },
    take: 200, // safety limit per cron run
  })

  let sent = 0

  for (const reservation of dueReservations) {
    const recipientEmail = reservation.anonId
      ? reservation.guestEmail
      : reservation.user?.email
    if (!recipientEmail) continue

    const data: ReservationEmailData = {
      reservationId: reservation.id,
      userEmail: recipientEmail,
      siteName: reservation.site?.name ?? 'Beach',
      siteId: reservation.site?.id ?? reservation.siteId,
      sunbedNumbers: reservation.items.map(i => i.number),
      fromDate: reservation.from,
      toDate: reservation.to,
      amount: reservation.paymentAmount,
      guestName: reservation.guestName,
    }

    try {
      await sendEmail({
        to: data.userEmail,
        subject: `Reminder: Your Beach Day at ${data.siteName}`,
        html: reminderHtml(data),
      })

      await prisma.reservation.update({
        where: { id: reservation.id },
        data: { reminderSentAt: new Date() },
      })

      sent++
    } catch (err) {
      console.error(`[sendDueReminders] Failed for ${reservation.id}:`, err)
    }
  }

  return sent
}
