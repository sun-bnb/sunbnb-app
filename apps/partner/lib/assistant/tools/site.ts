import prisma from '@repo/data/PrismaCient'
import { providerReadiness, READINESS_SELECT, selectedProvider, toReadinessAccount } from '@repo/data/payment-providers/readiness'
import { getSiteItemCounts } from '@/app/sites/[id]/item-counts'
import { getParcelSummaries } from '@/app/sites/[id]/parcels'
import { defineTool, maskIban } from './helpers'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export const getSiteOverview = defineTool({
  name: 'get_site_overview',
  label: 'Reading site overview',
  description:
    'Overview of the open site: name, type (paid = integrated payments, unpaid = off-platform), status (active/hidden), layout mode, price, VAT, features, counts (sunbeds, parcels, products, rental items, schematic elements, working-hour ranges) and payment provider readiness.',
  async run(_input, ctx) {
    const site = await prisma.site.findUnique({
      where: { id: ctx.siteId },
      select: {
        name: true, type: true, status: true, layoutMode: true, layoutWidth: true, layoutHeight: true,
        price: true, vat: true, rentalVat: true, features: true, slug: true, timeZone: true,
        appSalesEnabled: true, orderPaymentType: true, rentalPaymentType: true,
        partialGroupBookingEnabled: true, noShowDeadlineMinutes: true, image: true,
      },
    })
    if (!site) return { ok: false, error: 'site_not_found' }

    const [counts, parcels, products, rentalItems, elements, hours, account] = await Promise.all([
      getSiteItemCounts(ctx.siteId),
      getParcelSummaries(ctx.siteId),
      prisma.product.count({ where: { siteId: ctx.siteId } }),
      prisma.rentalItem.count({ where: { siteId: ctx.siteId } }),
      prisma.layoutElement.count({ where: { siteId: ctx.siteId } }),
      prisma.siteWorkingHours.count({ where: { siteId: ctx.siteId } }),
      prisma.partnerAccount.findUnique({ where: { userId: ctx.accountId }, select: READINESS_SELECT }),
    ])

    let payments: { provider: string; ready: boolean; status: string; nextStep: string | null } | null = null
    if (account) {
      const acc = toReadinessAccount(account)
      const r = providerReadiness(acc, selectedProvider(acc))
      payments = { provider: r.provider, ready: r.ready, status: r.status, nextStep: r.nextStep }
    }

    return {
      name: site.name,
      type: site.type ?? 'paid',
      status: site.status,
      layoutMode: site.layoutMode,
      ...(site.layoutMode === 'schematic' ? { layoutMetres: { width: site.layoutWidth, height: site.layoutHeight } } : {}),
      pricePerSunbed: site.price,
      vatPercent: site.vat,
      rentalVatPercent: site.rentalVat,
      features: site.features,
      slug: site.slug,
      timeZone: site.timeZone,
      appOrdersEnabled: site.appSalesEnabled,
      orderPayment: site.orderPaymentType,
      rentalPayment: site.rentalPaymentType,
      partialGroupBooking: site.partialGroupBookingEnabled,
      noShowDeadlineMinutes: site.noShowDeadlineMinutes,
      hasCoverImage: !!site.image,
      counts: {
        sunbeds: counts.itemCount,
        activeSunbeds: counts.activeItemCount,
        availableToday: counts.availableTodayCount,
        parcels: parcels.parcels.length,
        ungroupedSunbeds: parcels.ungroupedCount,
        products,
        rentalItems,
        layoutElements: elements,
        workingHourRanges: hours,
      },
      payments,
    }
  },
})

export const getWorkingHours = defineTool({
  name: 'get_working_hours',
  label: 'Reading working hours',
  description: 'The open site\'s booking/working hours: one row per time range with weekday and HH:MM open/close.',
  async run(_input, ctx) {
    const rows = await prisma.siteWorkingHours.findMany({
      where: { siteId: ctx.siteId },
      select: { day: true, openTime: true, closeTime: true },
      orderBy: { day: 'asc' },
    })
    const hhmm = (d: Date) => d.toISOString().slice(11, 16)
    return {
      ranges: rows.map((r) => ({ day: DAY_NAMES[r.day] ?? String(r.day), open: hhmm(r.openTime), close: hhmm(r.closeTime) })),
    }
  },
})

export const getBrand = defineTool({
  name: 'get_brand',
  label: 'Reading brand settings',
  description: 'Brand tab settings of the open site: brand name, public page address (slug), tagline, colours, and whether a logo / background image is set.',
  async run(_input, ctx) {
    const [site, brand] = await Promise.all([
      prisma.site.findUnique({ where: { id: ctx.siteId }, select: { slug: true, customBrandEnabled: true } }),
      prisma.siteBrand.findUnique({ where: { siteId: ctx.siteId } }),
    ])
    if (!brand) return { configured: false, slug: site?.slug ?? null }
    return {
      configured: true,
      brandName: brand.brandName,
      slug: site?.slug ?? null,
      tagline: brand.tagline,
      colors: { primary: brand.primaryColor, accent: brand.accentColor, background: brand.bgColor, foreground: brand.fgColor },
      hasLogo: !!brand.logoUrl,
      hasBackgroundImage: !!brand.bgImageUrl,
      bespokePageLive: !!site?.customBrandEnabled,
    }
  },
})

export const getContent = defineTool({
  name: 'get_content',
  label: 'Reading site content',
  description: 'Content tab of the open site: description text, on-site services (wc, food, drinks, rental) and whether a cover image is set.',
  async run(_input, ctx) {
    const site = await prisma.site.findUnique({
      where: { id: ctx.siteId },
      select: { description: true, services: true, image: true },
    })
    if (!site) return { ok: false, error: 'site_not_found' }
    const description = site.description ?? ''
    return {
      description: description.length > 1000 ? `${description.slice(0, 1000)}…` : description,
      services: site.services,
      hasCoverImage: !!site.image,
    }
  },
})

export const getAccountProfile = defineTool({
  name: 'get_account_profile',
  label: 'Reading account details',
  description: 'The partner account (company) profile that owns this site: company, contact, address, tax id and its validation status, invoice series prefix, selected payment provider. The bank account is masked.',
  async run(_input, ctx) {
    const a = await prisma.partnerAccount.findUnique({
      where: { userId: ctx.accountId },
      select: {
        firstName: true, lastName: true, email: true, phoneNumber: true, company: true, websiteUrl: true,
        address: true, city: true, postalCode: true, country: true, bankAccount: true, businessId: true,
        vatIdStatus: true, taxRegion: true, invoiceSeriesPrefix: true, paymentProvider: true,
      },
    })
    if (!a) return { exists: false }
    return {
      exists: true,
      company: a.company,
      contact: { firstName: a.firstName, lastName: a.lastName, email: a.email, phone: a.phoneNumber },
      websiteUrl: a.websiteUrl,
      address: { street: a.address, city: a.city, postalCode: a.postalCode, country: a.country },
      businessId: a.businessId,
      vatIdStatus: a.vatIdStatus,
      taxRegion: a.taxRegion,
      bankAccountMasked: maskIban(a.bankAccount),
      invoiceSeriesPrefix: a.invoiceSeriesPrefix,
      selectedPaymentProvider: a.paymentProvider,
    }
  },
})
