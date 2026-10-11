/**
 * `readiness` aspect: go-live checklist state (the same rules as the portal's ReadinessChecklist,
 * `app/sites/readiness-checklist.tsx`), the payment provider selected vs effective + its readiness,
 * and what currently blocks bookings. Token-free: the account row is projected through
 * `toReadinessAccount`, which turns the Mollie access token into a boolean.
 */
import prisma from '@repo/data/PrismaCient'
import { availabilityFor, PROVIDER_LABELS } from '@repo/data/payment-providers/availability'
import { isSelectableProvider, providerReadiness, READINESS_SELECT, selectedProvider, toReadinessAccount } from '@repo/data/payment-providers/readiness'
import { getSiteItemCounts } from '@/app/sites/[id]/item-counts'
import type { InspectProvider } from './types'

export interface ChecklistItem { key: string; label: string; met: boolean; where: string }

interface SiteFacts {
  name: string | null
  type: string | null
  status: string | null
  locationLat: string | null
  locationLng: string | null
  price: number | null
  vat: number | null
  image: string | null
  orderPaymentType: string | null
  rentalPaymentType: string | null
  workingHours: number
  activeSunbeds: number
  paymentReady: boolean | null
  paymentWhere: string | null
}

/** Mirrors `computeMissing` in readiness-checklist.tsx (a test pins the item set). */
export function checklist(f: SiteFacts): ChecklistItem[] {
  const paid = f.type === 'paid'
  const items: ChecklistItem[] = [
    { key: 'name', label: 'Site name', met: !!f.name && f.name.trim().length > 0, where: 'General tab' },
    { key: 'location', label: 'Location on the map', met: !!f.locationLat && !!f.locationLng && f.locationLat !== '0' && f.locationLng !== '0', where: 'General tab' },
  ]
  if (paid) {
    items.push({ key: 'price', label: 'Base price', met: !!f.price && f.price > 0, where: 'General tab' })
    items.push({ key: 'vat', label: 'VAT rate', met: f.vat != null && f.vat >= 0, where: 'General tab' })
  }
  items.push(
    { key: 'working-hours', label: 'Working hours (at least one day)', met: f.workingHours > 0, where: 'General tab' },
    { key: 'inventory', label: 'At least one active sunbed', met: f.activeSunbeds > 0, where: 'Inventory tab' },
    { key: 'image', label: 'Cover photo', met: !!f.image, where: 'Content tab' },
  )
  const integrated = paid || f.orderPaymentType === 'paid' || f.rentalPaymentType === 'paid'
  if (integrated && f.paymentReady != null) {
    items.push({ key: 'payments', label: 'Payment provider connected and ready', met: f.paymentReady, where: f.paymentWhere ?? 'Account > Payments' })
  }
  return items
}

export const readinessProvider: InspectProvider = {
  name: 'readiness',
  summary: 'Go-live checklist state for the open site, the payment provider selected vs effective and its readiness, and what blocks bookings right now.',
  examples: ['Is my site ready to take bookings?', 'What is missing before going live?', 'Which payment provider am I using and is it connected?'],
  async describe(ctx) {
    const [site, account, counts, hours] = await Promise.all([
      prisma.site.findUnique({
        where: { id: ctx.siteId },
        select: { name: true, type: true, status: true, locationLat: true, locationLng: true, price: true, vat: true, image: true, orderPaymentType: true, rentalPaymentType: true, paymentProvider: true, appSalesEnabled: true },
      }),
      prisma.partnerAccount.findUnique({ where: { userId: ctx.accountId }, select: READINESS_SELECT }),
      getSiteItemCounts(ctx.siteId),
      prisma.siteWorkingHours.count({ where: { siteId: ctx.siteId } }),
    ])
    if (!site) return { ok: false, error: 'site_not_found' }

    let payments: Record<string, unknown> | null = null
    let paymentReady: boolean | null = null
    let paymentWhere: string | null = null
    if (account) {
      const acc = toReadinessAccount(account)
      const selected = selectedProvider(acc)
      const effective = isSelectableProvider(site.paymentProvider) ? site.paymentProvider : selected
      const r = providerReadiness(acc, effective)
      const avail = availabilityFor(effective, acc.country)
      paymentReady = r.ready
      paymentWhere = r.connectPath
      payments = {
        selected: PROVIDER_LABELS[selected],
        effective: PROVIDER_LABELS[effective],
        selectedIsEffective: selected === effective,
        connected: r.connected,
        ready: r.ready,
        status: r.status,
        nextStep: r.nextStep,
        connectAt: r.connectPath,
        cardPresent: avail.cardPresent,
        ...(selected !== effective ? { why: 'the effective provider stays the previous working one until the selected provider is ready, so switching never strands the venue' } : {}),
      }
    }

    const items = checklist({
      name: site.name, type: site.type, status: site.status, locationLat: site.locationLat, locationLng: site.locationLng,
      price: site.price, vat: site.vat, image: site.image, orderPaymentType: site.orderPaymentType, rentalPaymentType: site.rentalPaymentType,
      workingHours: hours, activeSunbeds: counts.activeItemCount, paymentReady, paymentWhere,
    })
    const missing = items.filter((i) => !i.met)
    const blockers: string[] = []
    if (site.status !== 'active') blockers.push('The site is hidden (status is not active): guests cannot see it. Set Active on the General tab.')
    if (counts.activeItemCount === 0) blockers.push('No active sunbeds: nothing can be booked.')
    if (hours === 0) blockers.push('No working hours set (the go-live checklist requires at least one range).')
    if (site.type === 'paid' && paymentReady === false) blockers.push('Online payment is not ready, so guests cannot pay for bookings online.')
    if (site.type === 'paid' && !(site.price && site.price > 0)) blockers.push('No base price on a paid site.')

    return {
      ok: true,
      site: { name: site.name, status: site.status, billing: site.type === 'unpaid' ? 'off-platform' : 'integrated payments' },
      checklist: items,
      missing: missing.map((i) => `${i.label} (${i.where})`),
      readyToGoLive: missing.length === 0,
      blocksBookings: blockers,
      payments,
      counts: { activeSunbeds: counts.activeItemCount, sunbeds: counts.itemCount, workingHourRanges: hours },
    }
  },
}
