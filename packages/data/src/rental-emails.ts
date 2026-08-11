/**
 * Rental Email Service
 *
 * Sends transactional emails for the rental booking lifecycle:
 *   - Confirmation: immediately after successful payment (wired into processConfirmedRentalBooking)
 *   - Reminder: morning of the rental day (app-level trigger in apps/user cron — Phase 4b)
 *   - Cancellation: when the user or partner cancels (app-level trigger in apps/user cancel action — Phase 4b)
 *
 * Recipient rule (mirrors reservation-emails.ts):
 *   anonId ? guestEmail : user.email
 * Anonymous bookings without a guestEmail are silently skipped (QR/POS anon-no-email).
 *
 * All emails are plain HTML — no external template engine.
 * Uses the shared sendEmail() utility backed by Resend.
 *
 * Phase 4b app-level wiring still needed:
 *   - sendRentalDueReminders: call from apps/user /api/cron/send-reminders (or a
 *     dedicated rental-reminder cron route). The reminderSentAt dedup is now active.
 *   - sendRentalCancellationEmail: call from the cancelRentalBooking server action
 *     in apps/user (analogous to how sendCancellationEmail is called for sunbeds).
 */

import prisma from '../index'
import { sendEmail } from './email'
import { siteDayKey } from './site-day'
import { RENTAL_COMPLETE, RENTAL_PROCESSING } from './reservation-status'

// ─── Types ──────────────────────────────────────────────────────────────────

interface RentalEmailData {
  bookingId: string
  paymentRef: string
  userEmail: string
  siteName: string
  siteId: string
  itemName: string
  quantity: number
  durationType: 'hours' | 'days' | string
  from: Date
  to: Date
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

function formatDateTime(d: Date): string {
  return new Date(d).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatCurrency(amount: number | null): string {
  if (amount == null || amount === 0) return 'Free'
  return `€${amount.toFixed(2)}`
}

function formatWindow(from: Date, to: Date, durationType: string): string {
  if (durationType === 'days') {
    const f = formatDate(from)
    const t = formatDate(to)
    return f === t ? f : `${f} – ${t}`
  }
  // hours: show date + time range
  return `${formatDateTime(from)} – ${new Date(to).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`
}

function durationLabel(durationType: string): string {
  return durationType === 'days' ? 'Date' : 'Time'
}

// ─── Shared Layout ──────────────────────────────────────────────────────────

function emailLayout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f7f7f7;">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">
    <div style="background:#1a1a2e;padding:24px 32px;">
      <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">&#9728;&#65039; Sunbnb</span>
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

function rentalConfirmationHtml(data: RentalEmailData): string {
  return emailLayout(`
    <h1 style="margin:0 0 8px;font-size:22px;color:#1a1a2e;">Equipment Rental Confirmed &#10003;</h1>
    <p style="color:#666;margin:0 0 24px;font-size:15px;">Your equipment rental is all set.</p>

    <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333;">
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888;width:120px;">Location</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-weight:600;">${data.siteName}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888;">Equipment</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;">${data.itemName}${data.quantity > 1 ? ` &times; ${data.quantity}` : ''}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888;">${durationLabel(data.durationType)}</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;">${formatWindow(data.from, data.to, data.durationType)}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;color:#888;">Amount</td>
        <td style="padding:10px 0;font-weight:600;">${formatCurrency(data.amount)}</td>
      </tr>
    </table>

    <div style="margin:28px 0 0;padding:16px;background:#f0fdf4;border-radius:8px;border-left:4px solid #22c55e;">
      <p style="margin:0;font-size:14px;color:#166534;">
        <strong>Booking ID:</strong> ${data.bookingId.slice(0, 8).toUpperCase()}
      </p>
      <p style="margin:4px 0 0;font-size:13px;color:#15803d;">Show this to the beach attendant when collecting your equipment.</p>
    </div>

    <p style="margin:24px 0 0;font-size:13px;color:#999;">
      Need to cancel? Open your reservations in the Sunbnb app.
    </p>
  `)
}

// ─── Template: Reminder ─────────────────────────────────────────────────────

function rentalReminderHtml(data: RentalEmailData): string {
  return emailLayout(`
    <h1 style="margin:0 0 8px;font-size:22px;color:#1a1a2e;">Your Rental is Today! &#9728;&#65039;</h1>
    <p style="color:#666;margin:0 0 24px;font-size:15px;">Just a friendly reminder about your equipment rental.</p>

    <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333;">
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888;width:120px;">Location</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-weight:600;">${data.siteName}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888;">Equipment</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;">${data.itemName}${data.quantity > 1 ? ` &times; ${data.quantity}` : ''}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;color:#888;">${durationLabel(data.durationType)}</td>
        <td style="padding:10px 0;">${formatWindow(data.from, data.to, data.durationType)}</td>
      </tr>
    </table>

    <div style="margin:28px 0 0;padding:16px;background:#eff6ff;border-radius:8px;border-left:4px solid #3b82f6;">
      <p style="margin:0;font-size:14px;color:#1e40af;">
        Head to <strong>${data.siteName}</strong> and show your booking ID to collect your equipment. Enjoy your day!
      </p>
    </div>
  `)
}

// ─── Template: Cancellation ─────────────────────────────────────────────────

function rentalCancellationHtml(data: RentalEmailData): string {
  return emailLayout(`
    <h1 style="margin:0 0 8px;font-size:22px;color:#1a1a2e;">Rental Cancelled</h1>
    <p style="color:#666;margin:0 0 24px;font-size:15px;">Your equipment rental has been cancelled.</p>

    <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333;">
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888;width:120px;">Location</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-weight:600;">${data.siteName}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#888;">Equipment</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;">${data.itemName}${data.quantity > 1 ? ` &times; ${data.quantity}` : ''}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;color:#888;">${durationLabel(data.durationType)}</td>
        <td style="padding:10px 0;">${formatWindow(data.from, data.to, data.durationType)}</td>
      </tr>
    </table>

    <p style="margin:24px 0 0;font-size:14px;color:#666;">
      If a refund was applicable, it will be processed to your original payment method within 5–10 business days.
    </p>
  `)
}

// ─── Data Loader ────────────────────────────────────────────────────────────

/**
 * Load email data for a single rental booking.
 *
 * Recipient rule (mirrors loadReservationEmailData):
 *   anonId ? guestEmail : user.email
 * Returns null (no email) when:
 *   - booking not found
 *   - anonymous with no guestEmail (QR/POS walk-in, no email captured)
 *   - auth user with no email on record (shouldn't happen but guard it)
 */
async function loadRentalEmailData(bookingId: string): Promise<RentalEmailData | null> {
  const booking = await prisma.rentalBooking.findUnique({
    where: { id: bookingId },
    include: {
      user: { select: { email: true, name: true } },
      site: { select: { name: true, id: true } },
      rentalItem: { select: { name: true } },
    },
  })

  if (!booking) return null

  // For anonymous bookings the user FK points at the site owner — never email them.
  // Use guestEmail collected at checkout. No guestEmail = no email (QR/POS anon).
  const recipientEmail = booking.anonId
    ? booking.guestEmail
    : booking.user?.email
  if (!recipientEmail) return null

  return {
    bookingId: booking.id,
    paymentRef: booking.paymentRef ?? '',
    userEmail: recipientEmail,
    siteName: booking.site?.name ?? 'Beach',
    siteId: booking.site?.id ?? booking.siteId,
    itemName: booking.rentalItem?.name ?? 'Equipment',
    quantity: booking.quantity,
    durationType: booking.durationType,
    from: booking.from,
    to: booking.to,
    amount: booking.paymentAmount,
    guestName: booking.guestName,
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Send equipment rental confirmation email.
 *
 * Called after processConfirmedRentalBooking completes successfully.
 * Pass the id of any booking in the group (the group shares a paymentRef;
 * we use the first booking's data for the email since they share site/item for
 * a typical single-item rental — groups of mixed items use the first booking).
 *
 * Non-throwing: logs errors but does not fail the payment flow.
 */
export async function sendRentalConfirmationEmail(bookingId: string): Promise<void> {
  try {
    const data = await loadRentalEmailData(bookingId)
    if (!data) {
      console.warn(`[sendRentalConfirmationEmail] No data (or no recipient) for booking ${bookingId}`)
      return
    }
    await sendEmail({
      to: data.userEmail,
      subject: `Equipment Rental Confirmed — ${data.siteName}`,
      html: rentalConfirmationHtml(data),
    })
  } catch (err) {
    console.error(`[sendRentalConfirmationEmail] Failed for ${bookingId}:`, err)
  }
}

/**
 * Send rental cancellation email.
 *
 * Called after a rental booking is cancelled by the user or partner.
 * Phase 4b: wire into the cancelRentalBooking server action in apps/user.
 *
 * Non-throwing: logs errors but does not fail the cancellation flow.
 */
export async function sendRentalCancellationEmail(bookingId: string): Promise<void> {
  try {
    const data = await loadRentalEmailData(bookingId)
    if (!data) {
      console.warn(`[sendRentalCancellationEmail] No data (or no recipient) for booking ${bookingId}`)
      return
    }
    await sendEmail({
      to: data.userEmail,
      subject: `Rental Cancelled — ${data.siteName}`,
      html: rentalCancellationHtml(data),
    })
  } catch (err) {
    console.error(`[sendRentalCancellationEmail] Failed for ${bookingId}:`, err)
  }
}

/**
 * Send reminder emails for today's rental bookings not yet reminded.
 *
 * Mirrors sendDueReminders for sunbed reservations. Designed to be called from
 * a cron job (e.g., every morning at 07:00 UTC).
 *
 * Targets bookings where:
 *   - status is complete or processing (paid, not cancelled)
 *   - from date falls today (works for both days and hours bookings)
 *   - operationalStatus is 'reserved' (not yet picked up)
 *   - reminderSentAt is null (not yet reminded — idempotent dedup)
 *
 * Phase 4b app-level wiring (apps/user):
 *   - Call sendRentalDueReminders() from /api/cron/send-reminders alongside
 *     sendDueReminders(), OR add a dedicated rental-reminder cron route.
 *
 * Returns the count of reminders sent.
 */
/** Build the `SiteTimezone` shape `siteDayKey` expects from a site row. */
function rentalSiteTz(site: { timeZone?: string | null; locationLat?: string | null; locationLng?: string | null } | null) {
  return {
    timeZone: site?.timeZone ?? null,
    latitude: site?.locationLat ? parseFloat(site.locationLat) : undefined,
    longitude: site?.locationLng ? parseFloat(site.locationLng) : undefined,
  }
}

export async function sendRentalDueReminders(): Promise<number> {
  const now = new Date()

  // "from is today" = today in the VENUE's civil day, not the server's UTC day.
  // Cross-site query → fetch a ±36h candidate pool (covers every IANA offset)
  // and filter each row against its own site's timezone. See sendDueReminders.
  const windowStart = new Date(now.getTime() - 36 * 60 * 60 * 1000)
  const windowEnd = new Date(now.getTime() + 36 * 60 * 60 * 1000)

  const candidates = await prisma.rentalBooking.findMany({
    where: {
      operationalStatus: 'reserved',
      status: { in: [RENTAL_COMPLETE, RENTAL_PROCESSING] },
      from: { gte: windowStart, lt: windowEnd },
      reminderSentAt: null,
    },
    include: {
      user: { select: { email: true, name: true } },
      site: { select: { name: true, id: true, timeZone: true, locationLat: true, locationLng: true } },
      rentalItem: { select: { name: true } },
    },
    take: 500, // candidate pool (filtered to today-in-venue-tz below)
  })

  // Keep only bookings that START on the venue's civil today. For hours-mode
  // rentals `from` is the exact pickup instant, still on the venue day it lands.
  const dueBookings = candidates.filter((b) =>
    siteDayKey(rentalSiteTz(b.site), b.from) === siteDayKey(rentalSiteTz(b.site), now),
  )

  let sent = 0

  for (const booking of dueBookings) {
    const recipientEmail = booking.anonId
      ? booking.guestEmail
      : booking.user?.email
    if (!recipientEmail) continue

    const data: RentalEmailData = {
      bookingId: booking.id,
      paymentRef: booking.paymentRef ?? '',
      userEmail: recipientEmail,
      siteName: booking.site?.name ?? 'Beach',
      siteId: booking.site?.id ?? booking.siteId,
      itemName: booking.rentalItem?.name ?? 'Equipment',
      quantity: booking.quantity,
      durationType: booking.durationType,
      from: booking.from,
      to: booking.to,
      amount: booking.paymentAmount,
      guestName: booking.guestName,
    }

    try {
      await sendEmail({
        to: data.userEmail,
        subject: `Reminder: Your Rental at ${data.siteName}`,
        html: rentalReminderHtml(data),
      })

      await prisma.rentalBooking.update({
        where: { id: booking.id },
        data: { reminderSentAt: new Date() },
      })

      sent++
    } catch (err) {
      console.error(`[sendRentalDueReminders] Failed for ${booking.id}:`, err)
    }
  }

  return sent
}
