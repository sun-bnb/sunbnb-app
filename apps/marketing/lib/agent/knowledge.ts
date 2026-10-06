/**
 * The sales agent's product knowledge (track 027): what Sunbnb does TODAY, what is coming, and
 * what it doesn't offer — one entry per topic, verified against the code on 2026-10-05 (sources
 * cited per entry; `main`, which is what try.sunbnb.app ships with).
 *
 * Rules for editing:
 *  - Only write what the code does. Public pages overclaim in places (scanning QR passes, hourly
 *    sunbeds, dynamic pricing, tiered refunds…) — those are listed under `neverClaim`.
 *  - A `coming` entry is a founder-approved promise of direction, never "works today".
 *  - Every number in `say` must be declared in `figures` (it joins the eval's allow-list).
 *  - Prices and plan limits are NOT written here — the fact sheet renders them from
 *    `@repo/data/pricing-tiers`, the catalogue billing uses.
 */
import { OFFERS } from '../offer.ts'
import type { KnowledgeEntry } from './knowledge-schema.ts'

export const KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'sunbed-booking',
    topic: 'Sunbed reservations',
    status: 'shipped',
    say: 'Guests pick their exact sunbed on the venue\'s map and book it for one day or a range of days, paying by card online. They don\'t need an account — an email address is enough. They get a booking page with a QR pass and a receipt, a confirmation email and a reminder email on the day. The venue chooses whether guests book the whole sunshade unit or single sunbeds. Walk-in guests can scan the QR card on a free sunbed or parasol to book it for today and pay on their own phone; scanning a sunbed they have already booked opens their booking.',
    neverClaim: ['sunbeds can be booked by the hour (hourly booking exists only for equipment rentals)', 'guests can cancel a sunbed booking themselves'],
    sources: ['apps/user/app/sites/[id]/actions.ts', 'apps/user/app/sites/[id]/Reservation.tsx', 'packages/data/src/reservation-emails.ts', 'apps/user/app/q/[site]/[unit]/page.tsx (seat QR card → today\'s booking for that spot)'],
  },
  {
    id: 'arrival',
    topic: 'Guest arrival and check-in',
    status: 'shipped',
    say: 'On arrival, staff find the booking by the guest\'s name, phone or email on the staff view and check the guest in with one tap. The sunbed then shows as occupied.',
    neverClaim: ['staff scan the QR pass', 'there is a scanner app', 'guests check themselves in'],
    sources: ['apps/partner/app/sites/[id]/manage/actions.ts', 'apps/user/app/reservations/[id]/pass/PassView.tsx (QR encodes the reservation id; no scanner exists)'],
  },
  {
    id: 'payments',
    topic: 'Payments and payouts',
    status: 'shipped',
    say: 'Guest payments go through Mollie, a licensed European payment provider. The venue connects its own Mollie account and is the merchant: Mollie pays the money out to the venue on Mollie\'s own schedule, with Sunbnb\'s commission deducted as a fee. Sunbnb never holds the venue\'s money. Staff can refund a booking in full from the staff view. Cash sales can also be recorded.',
    neverClaim: ['guests can pay through Stripe (Stripe is used only for the venue\'s plan subscription)', 'automatic partial or time-based refunds', 'Sunbnb collects the money and pays the venue out'],
    sources: ['apps/user/app/api/_lib/mollie.ts', 'packages/data/src/mollie-app-fee.ts', 'packages/data/src/refund.ts'],
  },
  {
    id: 'no-show',
    topic: 'No-shows and deposits',
    status: 'shipped',
    say: 'Sunbed, food and rental bookings are paid in advance, so a no-show has already paid. Restaurant table reservations can take an optional no-show deposit per guest, which a late cancellation forfeits.',
    neverClaim: ['deposits or no-show fees on sunbed bookings'],
    sources: ['apps/user/app/api/table-reservations/[id]/deposit/mollie', 'packages/data/prisma/schema.prisma (Site.noShowDeadlineMinutes unused)'],
  },
  {
    id: 'cancellation',
    topic: 'Cancellations and refunds',
    status: 'shipped',
    say: 'Guests who cancel more than 24 hours before the booking date get a full refund; within 24 hours of the booking date, or for a no-show, there is no refund. If the venue cancels (for example for weather), the guest gets a full refund. Refunds go back through the payment provider to the guest\'s card.',
    neverClaim: ['partial refunds', 'a 50% refund tier'],
    figures: [24],
    sources: ['apps/user/app/cancellation-policy/page.tsx (founder decision 2026-10-06: 100% if > 24 h before, none within 24 h)', 'packages/data/src/refund.ts'],
  },
  {
    id: 'food-drink',
    topic: 'Food and drink orders',
    status: 'shipped',
    say: 'Guests order food and drinks to their sunbed from their booking page, or by scanning the QR card on the sunbed, and pay in the same flow (or the venue bills it off-platform). Staff see orders on a live order board with a sound alert and move them through new, accepted, preparing, ready and delivered. At restaurant tables, guests can open a tab with the table\'s QR code, order in rounds and pay at the end.',
    neverClaim: ['a separate kitchen display system', 'printer or POS integrations'],
    sources: ['apps/user/app/reservations/[id]/Menu.tsx', 'apps/partner/app/sites/[id]/orders/view.tsx', 'apps/user/app/tables/[tableId]'],
  },
  {
    id: 'rentals',
    topic: 'Equipment rentals',
    status: 'shipped',
    say: 'Venues can rent out equipment — surfboards, paddleboards, kayaks, pedal boats, snorkel gear and more — by the hour or by the day, with stock limits. Guests book and pay without an account and can cancel themselves; staff can add walk-in rentals and mark items picked up and returned.',
    sources: ['packages/data/prisma/schema.prisma (RentalItem, RentalBooking)', 'apps/user/app/reservations/rental/[id]', 'apps/partner/app/sites/[id]/manage (createWalkInRental)'],
  },
  {
    id: 'tables',
    topic: 'Restaurant table reservations',
    status: 'shipped',
    say: 'Beach restaurants get table reservations with a floor plan of their tables, table combinations, shifts and opening hours, a waitlist, and a booking widget they can embed on their own website.',
    sources: ['apps/partner/app/restaurants/[id]/tables', 'apps/partner/app/restaurants/[id]/reservations', 'apps/user/app/embed/[restaurantId]'],
  },
  {
    id: 'staff-view',
    topic: 'Staff view on site',
    status: 'shipped',
    say: 'Staff work from a live grid of the sunbeds: walk-ins, check-ins, departures, no-shows, moving guests, blocking or complimentary sunbeds, and booking several sunbeds as one group. Cash sales get a receipt and are tracked per employee, with a till and a day close. Staff get access through a link at staff or manager level.',
    neverClaim: ['individual staff accounts with per-person permissions', 'a native mobile app in the App Store or Google Play'],
    sources: ['apps/partner/app/sites/[id]/manage/actions.ts', 'apps/partner/app/security/actions.ts', '.claude/tracks/008-employee-model.md', 'apps/mobile (development only)'],
  },
  {
    id: 'invoicing',
    topic: 'Invoices, receipts and VAT',
    status: 'shipped',
    say: 'Every online sale automatically produces the guest\'s receipt/invoice in the venue\'s name, with the venue\'s own invoice numbering and VAT rate (a separate rate can be set for rentals). Sunbnb\'s commission is invoiced to the venue separately. Cash sales get a receipt too. The accounting section shows a fiscal summary, VAT by rate, credit notes and an invoice register you can export as CSV.',
    neverClaim: ['integration with accounting software', 'monthly settlement statements', 'tax or legal advice'],
    sources: ['packages/data/src/payment.ts', 'apps/partner/app/sites/[id]/accounting/view.tsx'],
  },
  {
    id: 'verifactu',
    topic: 'Veri*factu (Spain)',
    status: 'coming',
    say: 'Veri*factu compliance for Spanish venues is coming before the 2027 deadline. Sunbnb is building it into its invoicing: chained invoice records, the AEAT QR code on receipts, and sending the records to the Spanish Tax Agency (AEAT) on the venue\'s behalf, with the venue\'s authorisation.',
    neverClaim: ['receipts carry the AEAT QR code or are sent to AEAT today', 'Sunbnb is certified or homologated software', 'a specific go-live date'],
    figures: [2027],
    sources: ['.claude/tracks/026-verifactu.md', 'packages/data/src/tax/es-verifactu/client.ts (stub mode by default)', 'founder approval 2026-10-05: "say verifactu is coming before the 2027 deadline"'],
  },
  {
    id: 'pricing-control',
    topic: 'Setting prices',
    status: 'shipped',
    say: 'The venue sets its own price per day for the whole venue, per section or per individual sunbed, so front-row or premium sunbeds can cost more. Rentals have hourly and daily prices.',
    neverClaim: ['seasonal or dynamic pricing', 'discount or promo codes'],
    sources: ['packages/data/prisma/schema.prisma (InventoryItem.price, ItemGroup.price)', 'apps/partner/app/sites/[id]/inventory/ParcelForm.tsx'],
  },
  {
    id: 'not-offered',
    topic: 'Not offered',
    status: 'not_offered',
    say: 'Sunbnb does not offer seasonal or dynamic pricing, discount codes, demand forecasts, guest feedback or reviews, a hotel booking channel, or card terminals. Staff take cash, or show a QR code the guest pays with on their own phone.',
    neverClaim: ['any of these is available', 'any of these is coming (no date or promise)'],
    sources: ['apps/partner/app/info (overclaims; verified absent in code)', '.claude/tracks/024-card-present-payments.md (not live)'],
  },
  {
    id: 'analytics',
    topic: 'Reports',
    status: 'shipped',
    say: 'Venues see their revenue trend, occupancy and complimentary sunbeds, a per-day breakdown, sales by channel and per employee, and can export to CSV.',
    sources: ['apps/partner/app/sites/[id]/accounting', 'apps/partner/app/sites/[id]/manage/trends'],
  },
  {
    id: 'branded-page',
    topic: 'Branded booking page',
    status: 'shipped',
    say: 'On the Business plan, the venue gets its own booking page with its colours, logo and tagline.',
    sources: ['apps/user/brands', 'apps/partner/app/sites/[id]/brand/view.tsx'],
  },
  {
    id: 'setup',
    topic: 'Getting started',
    status: 'shipped',
    say: 'The venue creates its site in a short wizard, then places its sunbeds on a satellite map or a drawn plan — rows, spacing and rotation — and can drag, turn and renumber them and print QR cards for the sunbeds. A checklist shows what is still missing before going live, such as prices, VAT and connecting Mollie.',
    neverClaim: ['a specific setup time', 'importing bookings or layouts from another system'],
    sources: ['apps/partner/app/sites/create', 'apps/partner/app/sites/[id]/inventory', 'apps/partner/app/sites/readiness-checklist.tsx'],
  },
  {
    id: 'devices',
    topic: 'Devices and hardware',
    status: 'shipped',
    say: 'Everything runs in the browser on the phones, tablets and laptops the venue already has. There is no hardware to buy, and guests don\'t need to download an app.',
    neverClaim: ['a native app in the App Store or Google Play', 'sunbed lights, sensors or other hardware'],
    sources: ['apps/user', 'apps/partner', 'apps/mobile (development only)'],
  },
  {
    id: 'languages',
    topic: 'Languages and currency',
    status: 'shipped',
    say: 'The guest and venue apps are available in English, Spanish and Finnish, chosen from the browser\'s language. Prices are in euros.',
    neverClaim: ['any other language', 'any other currency'],
    sources: ['apps/user/messages', 'apps/partner/messages', 'packages/data/src/reservation-payment.ts'],
  },
  {
    id: 'launch-offer',
    topic: 'Launch offer',
    status: 'shipped',
    say: OFFERS.en.launchOffer ?? '',
    figures: [30, 31, 2027],
    sources: ['apps/marketing/lib/offer.ts', 'packages/data/src/promotion.ts (enforced by billing)'],
  },
]
