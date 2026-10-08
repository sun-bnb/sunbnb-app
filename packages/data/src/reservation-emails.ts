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
import { buildReservationReceipt } from './receipt'
import type { ReceiptModel } from './receipt-model'
import { sendEmail } from './email'
import { siteDayKey } from './site-day'
import { reservationListPrice } from './reservation-price'
import {
  RESERVATION_COMPLETE,
  RESERVATION_PROCESSING,
  OP_EXPECTED,
} from './reservation-status'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ReservationEmailData {
  reservationId: string
  userEmail: string
  siteName: string
  siteId: string
  sunbedNumbers: number[]
  fromDate: Date
  toDate: Date
  amount: number | null
  /**
   * What the guest owes AT THE VENUE: set only for an off-platform-billing
   * (Site.type 'unpaid') booking, which completes without any payment, so
   * `amount` is 0 there and "Free" would be wrong.
   */
  amountDue: number | null
  guestName: string | null
  /** Absolute link to the reservation view (carries anonId for a guest booking). */
  viewUrl: string
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

/**
 * Absolute URL of the consumer reservation view. Emails need an absolute link;
 * CONSUMER_APP_URL is the user app's origin per environment (same variable the
 * receipt QR uses), falling back to production.
 */
export function reservationViewUrl(reservationId: string, anonId: string | null): string {
  const base = (process.env.CONSUMER_APP_URL || 'https://sunbnb.app').replace(/\/+$/, '')
  const path = `/reservations/${encodeURIComponent(reservationId)}`
  return anonId ? `${base}${path}?anonId=${encodeURIComponent(anonId)}` : `${base}${path}`
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

/** Exported for tests and previews; send through `sendConfirmationEmail`. */
export function confirmationHtml(data: ReservationEmailData): string {
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
        <td style="padding:10px 0;font-weight:600;">${amountText(data)}</td>
      </tr>
    </table>
${data.amountDue ? `
    <p style="margin:16px 0 0;font-size:14px;color:#92400e;background:#fffbeb;border-radius:8px;padding:12px 16px;">
      Nothing has been charged. You pay ${formatCurrency(data.amountDue)} at the venue when you arrive.
    </p>` : ''}
    <div style="margin:28px 0 0;text-align:center;">
      <a href="${data.viewUrl}" style="display:inline-block;background:#1a1a2e;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 24px;border-radius:8px;">View your reservation</a>
    </div>

    <div style="margin:28px 0 0;padding:16px;background:#f0fdf4;border-radius:8px;border-left:4px solid #22c55e;">
      <p style="margin:0;font-size:14px;color:#166534;">
        <strong>Reservation ID:</strong> ${data.reservationId.slice(0, 8).toUpperCase()}
      </p>
      <p style="margin:4px 0 0;font-size:13px;color:#15803d;">Show this to the beach attendant when you arrive.</p>
    </div>

    <p style="margin:24px 0 0;font-size:13px;color:#999;">
      Need to cancel? <a href="${data.viewUrl}" style="color:#999;">Open your reservation</a>.
    </p>
  `)
}

/** Paid online → the amount; due at the venue → the amount and where; neither → Free. */
function amountText(data: ReservationEmailData): string {
  if (data.amount) return formatCurrency(data.amount)
  if (data.amountDue) return `${formatCurrency(data.amountDue)} — pay at the venue`
  return formatCurrency(null)
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

// ─── Template: Receipt ──────────────────────────────────────────────────────

/**
 * The EMAIL presenter of a receipt.
 *
 * Takes the same `ReceiptModel` as the HTML view and the PDF document, which is
 * how the three stop drifting. They already had: this template showed a VAT
 * RATE column where the other two showed a VAT AMOUNT, so a guest comparing the
 * email against the page saw different numbers under the same heading. It now
 * shows the amount, matching them.
 */
function receiptHtml(receipt: ReceiptModel): string {
  const merchant = receipt.merchant.name
  const lineRows = receipt.lines
    .map(
      (l) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;color:#333;">${l.description ?? '—'}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;color:#888;">€${l.vat.toFixed(2)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;">€${l.total.toFixed(2)}</td>
      </tr>`,
    )
    .join('')

  // The AEAT QR block. §3 of the QR spec puts it before the invoice content,
  // which in an email means above everything. Absent for a non-Spanish issuer.
  //
  // This is the reason the PNG is served from a route rather than inlined as a
  // data URI: Gmail strips `data:` images, and the emailed receipt is the copy a
  // guest keeps. The code is 132 px (35 mm at 96 dpi) with 23 px (6 mm) of white
  // quiet zone around it, supplied here rather than baked into the image.
  //
  // The literals are legal wording and are deliberately not translated, and the
  // legend must stay at or above the surrounding text size — not fine print.
  const fiscalBlock = receipt.fiscal
    ? `
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 20px;">
      <tr><td align="center" style="padding:0 0 4px;font-size:13px;color:#1a1a2e;">${receipt.fiscal.labelAbove}</td></tr>
      <tr><td align="center" style="padding:0;">
        <a href="${receipt.fiscal.qrUrl}" style="display:inline-block;background:#ffffff;padding:23px;text-decoration:none;">
          <img src="${receipt.fiscal.qrImageUrl}" width="132" height="132" alt="${receipt.fiscal.labelAbove}" style="display:block;width:132px;height:132px;border:0;" />
        </a>
      </td></tr>
      <tr><td align="center" style="padding:4px 0 0;font-size:13px;font-weight:700;color:#1a1a2e;">${receipt.fiscal.legendBelow}</td></tr>
    </table>`
    : ''

  return emailLayout(`
    ${fiscalBlock}
    <h1 style="margin:0 0 4px;font-size:22px;color:#1a1a2e;">Receipt</h1>
    <p style="color:#666;margin:0 0 20px;font-size:15px;">${merchant}</p>

    <table style="width:100%;border-collapse:collapse;font-size:13px;color:#333;margin-bottom:16px;">
      <tr>
        <td style="padding:4px 0;color:#888;width:130px;">Receipt no.</td>
        <td style="padding:4px 0;font-weight:600;">${receipt.invoiceNumber ?? '—'}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;color:#888;">Date</td>
        <td style="padding:4px 0;">${receipt.issuedAt}</td>
      </tr>
      ${receipt.merchant.vatId ? `<tr><td style="padding:4px 0;color:#888;">VAT no.</td><td style="padding:4px 0;">${receipt.merchant.vatId}</td></tr>` : ''}
      ${receipt.merchant.address ? `<tr><td style="padding:4px 0;color:#888;vertical-align:top;">Address</td><td style="padding:4px 0;">${receipt.merchant.address}</td></tr>` : ''}
    </table>

    <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333;">
      <tr>
        <td style="padding:8px 0;border-bottom:2px solid #eee;color:#888;font-size:12px;text-transform:uppercase;">Item</td>
        <td style="padding:8px 0;border-bottom:2px solid #eee;text-align:right;color:#888;font-size:12px;text-transform:uppercase;">VAT</td>
        <td style="padding:8px 0;border-bottom:2px solid #eee;text-align:right;color:#888;font-size:12px;text-transform:uppercase;">Total</td>
      </tr>
      ${lineRows}
    </table>

    <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333;margin-top:12px;">
      <tr>
        <td style="padding:4px 0;text-align:right;color:#888;">Net</td>
        <td style="padding:4px 0;text-align:right;width:100px;">€${receipt.subtotalCharge.toFixed(2)}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;text-align:right;color:#888;">VAT</td>
        <td style="padding:4px 0;text-align:right;">€${receipt.subtotalVat.toFixed(2)}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;text-align:right;font-weight:700;border-top:1px solid #eee;">Total paid</td>
        <td style="padding:8px 0;text-align:right;font-weight:700;border-top:1px solid #eee;">€${receipt.grandTotal.toFixed(2)}</td>
      </tr>
    </table>
  `)
}

// ─── Public API ─────────────────────────────────────────────────────────────

async function loadReservationEmailData(reservationId: string): Promise<ReservationEmailData | null> {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      user: { select: { email: true, name: true } },
      site: { select: { name: true, id: true, type: true, price: true } },
      items: { select: { number: true, price: true }, orderBy: { number: 'asc' } },
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
    amountDue: !reservation.paymentAmount && reservation.site?.type === 'unpaid'
      ? reservationListPrice({
          sitePrice: reservation.site.price,
          itemPrices: reservation.items.map(i => i.price),
          from: reservation.from,
          to: reservation.to,
        }) || null
      : null,
    guestName: reservation.guestName,
    viewUrl: reservationViewUrl(reservation.id, reservation.anonId),
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
 * Send a VAT receipt for a paid reservation to a customer-supplied address.
 *
 * Built from the PARTNER (gross) invoice created by `processConfirmedReservation`,
 * so it only works once the payment has been finalized. Used by the self-serve
 * "email me a receipt" step after a QR walk-in collection. Returns a result the
 * caller can surface to the customer (rather than throwing).
 */
export async function sendReceiptEmail(
  reservationId: string,
  toEmail: string,
): Promise<{ ok: boolean; error?: string }> {
  // One loader for every receipt surface — the query and mapping that used to
  // live here were a fourth copy of the same thing.
  const result = await buildReservationReceipt(reservationId)
  if (result.status === 'not-found') return { ok: false, error: 'Reservation not found' }
  if (result.status === 'no-invoice') return { ok: false, error: 'Receipt is not ready yet' }

  const { receipt } = result

  try {
    await sendEmail({
      to: toEmail,
      subject: `Your receipt — ${receipt.siteName ?? 'Sunbnb'}`,
      html: receiptHtml(receipt),
    })
    return { ok: true }
  } catch (err) {
    console.error(`[sendReceiptEmail] Failed for ${reservationId}:`, err)
    return { ok: false, error: 'Could not send the receipt' }
  }
}

/** Build the `SiteTimezone` shape `siteDayKey` expects from a site row. */
function siteTz(site: { timeZone?: string | null; locationLat?: string | null; locationLng?: string | null } | null) {
  return {
    timeZone: site?.timeZone ?? null,
    latitude: site?.locationLat ? parseFloat(site.locationLat) : undefined,
    longitude: site?.locationLng ? parseFloat(site.locationLng) : undefined,
  }
}

/**
 * Send reminder emails for today's reservations that haven't been reminded yet.
 * Designed to be called from a cron job (e.g., every morning at 7 AM).
 *
 * Targets reservations where:
 *   - operationalStatus = 'expected' (not yet checked in)
 *   - status is an active booking (not cancelled)
 *   - from date is today IN THE VENUE'S CIVIL DAY (not the server's UTC day)
 *   - reminderSentAt is null
 *
 * Returns the count of reminders sent.
 */
export async function sendDueReminders(): Promise<number> {
  const now = new Date()

  // "from is today" must mean today in the VENUE's civil day, not the server's
  // (UTC on Vercel). This is a cross-site query, so we can't anchor a single
  // window: fetch a generous ±36h candidate pool (covers every IANA offset,
  // −12h..+14h) then filter each row against its own site's timezone. A miss
  // here is unrecoverable — reminderSentAt is stamped regardless (see below).
  const windowStart = new Date(now.getTime() - 36 * 60 * 60 * 1000)
  const windowEnd = new Date(now.getTime() + 36 * 60 * 60 * 1000)

  const candidates = await prisma.reservation.findMany({
    where: {
      operationalStatus: OP_EXPECTED,
      status: { in: [RESERVATION_COMPLETE, RESERVATION_PROCESSING] },
      from: { gte: windowStart, lt: windowEnd },
      reminderSentAt: null,
    },
    include: {
      user: { select: { email: true, name: true } },
      site: { select: { name: true, id: true, timeZone: true, locationLat: true, locationLng: true } },
      items: { select: { number: true }, orderBy: { number: 'asc' } },
    },
    take: 500, // candidate pool (filtered to today-in-venue-tz below)
  })

  // Keep only bookings whose stay STARTS on the venue's civil today.
  const dueReservations = candidates.filter((r) =>
    siteDayKey(siteTz(r.site), r.from) === siteDayKey(siteTz(r.site), now),
  )

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
      amountDue: null, // the reminder template shows no amount
      guestName: reservation.guestName,
      viewUrl: reservationViewUrl(reservation.id, reservation.anonId),
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
