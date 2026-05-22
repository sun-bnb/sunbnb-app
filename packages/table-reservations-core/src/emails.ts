import type { TableReservationRecord } from './reservations/queries'

export interface RestaurantEmailContext {
  name: string
  slug: string
  tagline?: string | null
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatTime(d: Date): string {
  return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/** Minimal inline-styled HTML so most mail clients render it reasonably. */
function wrap(title: string, body: string): string {
  return `<!doctype html>
<html>
<body style="font-family: system-ui, -apple-system, sans-serif; color: #111; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h1 style="font-size: 20px; margin: 0 0 16px 0;">${title}</h1>
  ${body}
  <p style="color:#6b7280; font-size: 12px; margin-top: 32px;">
    This message was sent automatically. Reply if you have any questions.
  </p>
</body>
</html>`
}

export function confirmationEmailHtml(
  reservation: Pick<
    TableReservationRecord,
    'id' | 'from' | 'to' | 'partySize' | 'guestName' | 'specialRequests'
  >,
  restaurant: RestaurantEmailContext,
  cancelUrl: string | null,
): string {
  const body = `
  <p style="margin:0 0 16px 0;">Hi ${escapeHtml(reservation.guestName)},</p>
  <p style="margin:0 0 16px 0;">
    Your reservation at <strong>${escapeHtml(restaurant.name)}</strong> is confirmed.
  </p>
  <table style="border-collapse: collapse; width: 100%; font-size: 14px; margin-bottom: 16px;">
    <tr><td style="padding:4px 0;color:#6b7280;">Date</td><td style="padding:4px 0;">${formatDate(reservation.from)}</td></tr>
    <tr><td style="padding:4px 0;color:#6b7280;">Time</td><td style="padding:4px 0;">${formatTime(reservation.from)} – ${formatTime(reservation.to)}</td></tr>
    <tr><td style="padding:4px 0;color:#6b7280;">Party</td><td style="padding:4px 0;">${reservation.partySize} ${reservation.partySize === 1 ? 'guest' : 'guests'}</td></tr>
    ${reservation.specialRequests
      ? `<tr><td style="padding:4px 0;color:#6b7280;">Notes</td><td style="padding:4px 0;">${escapeHtml(reservation.specialRequests)}</td></tr>`
      : ''}
  </table>
  ${cancelUrl
    ? `<p style="margin:0 0 16px 0;"><a href="${cancelUrl}" style="color:#2563eb;">Cancel this reservation</a></p>`
    : ''}
  <p style="color:#6b7280; font-size: 13px;">Reservation id: ${reservation.id}</p>`
  return wrap(`Reservation confirmed at ${escapeHtml(restaurant.name)}`, body)
}

export function reminderEmailHtml(
  reservation: Pick<
    TableReservationRecord,
    'id' | 'from' | 'to' | 'partySize' | 'guestName'
  >,
  restaurant: RestaurantEmailContext,
  cancelUrl: string | null,
): string {
  const body = `
  <p style="margin:0 0 16px 0;">Hi ${escapeHtml(reservation.guestName)},</p>
  <p style="margin:0 0 16px 0;">
    A reminder of your upcoming reservation at <strong>${escapeHtml(restaurant.name)}</strong>.
  </p>
  <table style="border-collapse: collapse; width: 100%; font-size: 14px; margin-bottom: 16px;">
    <tr><td style="padding:4px 0;color:#6b7280;">Date</td><td style="padding:4px 0;">${formatDate(reservation.from)}</td></tr>
    <tr><td style="padding:4px 0;color:#6b7280;">Time</td><td style="padding:4px 0;">${formatTime(reservation.from)} – ${formatTime(reservation.to)}</td></tr>
    <tr><td style="padding:4px 0;color:#6b7280;">Party</td><td style="padding:4px 0;">${reservation.partySize} ${reservation.partySize === 1 ? 'guest' : 'guests'}</td></tr>
  </table>
  ${cancelUrl
    ? `<p style="margin:0 0 16px 0;"><a href="${cancelUrl}" style="color:#2563eb;">Can't make it? Cancel here</a></p>`
    : ''}
  <p style="color:#6b7280; font-size: 13px;">We look forward to seeing you.</p>`
  return wrap(`Reminder: your reservation at ${escapeHtml(restaurant.name)}`, body)
}

export function cancellationEmailHtml(
  reservation: Pick<
    TableReservationRecord,
    'id' | 'from' | 'to' | 'partySize' | 'guestName'
  >,
  restaurant: RestaurantEmailContext,
): string {
  const body = `
  <p style="margin:0 0 16px 0;">Hi ${escapeHtml(reservation.guestName)},</p>
  <p style="margin:0 0 16px 0;">
    Your reservation at <strong>${escapeHtml(restaurant.name)}</strong> on
    ${formatDate(reservation.from)} at ${formatTime(reservation.from)} has been
    canceled.
  </p>
  <p style="color:#6b7280; font-size: 13px;">Reservation id: ${reservation.id}</p>`
  return wrap(`Reservation canceled at ${escapeHtml(restaurant.name)}`, body)
}

export function waitlistNotifyEmailHtml(
  entry: { guestName: string; dateISO: string; partySize: number },
  restaurant: RestaurantEmailContext,
  bookUrl: string | null,
): string {
  const body = `
  <p style="margin:0 0 16px 0;">Hi ${escapeHtml(entry.guestName)},</p>
  <p style="margin:0 0 16px 0;">
    Good news — a table has opened up at <strong>${escapeHtml(restaurant.name)}</strong> on
    ${escapeHtml(entry.dateISO)} for ${entry.partySize} ${entry.partySize === 1 ? 'guest' : 'guests'}.
  </p>
  ${bookUrl
    ? `<p style="margin:0 0 16px 0;"><a href="${bookUrl}" style="color:#2563eb;">Book now</a> — spots go fast.</p>`
    : '<p style="margin:0 0 16px 0;">Reply or visit our page to book — spots go fast.</p>'}`
  return wrap(`A table opened up at ${escapeHtml(restaurant.name)}`, body)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
