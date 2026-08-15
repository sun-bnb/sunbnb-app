import prisma from '@repo/data/PrismaCient'
import { getSiteFeeContext } from '@repo/data/payment'
import { resolveServiceFee } from '@repo/data/payment'
import { auth } from '@/app/auth'
import { SiteProps } from '@/types/shared'
import SiteView from './site-view'
import ErrorCard from '@/components/ErrorCard'
import { INVENTORY_ITEM_SELECT } from './[id]/item-select'
import { getSiteItemCounts } from './[id]/item-counts'
import { getParcelSummaries } from './[id]/parcels'


export default async function SitePage(
  { params, tab, children }:
  { 
    params: { id: string }
    tab: string
    children?: React.ReactNode | React.ReactNode[]
  }
) {

  const session = await auth()
  if (!session?.user) return null

  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string

  let site: SiteProps | null = {
    name: '',
    services: []
  }

  // Track 020 C2: only the two EDITOR tabs need seat rows. Every other tab
  // read at most a count, yet all eight paid for the full array — 4 436 items
  // with whole pair/pairedBy rows and every item's reservations (guest emails
  // included) measured 5.5MB of RSC payload on the founder's site. Counts are
  // now server-computed scalars; the editors get a narrowed item select.
  // The inventory editor runs on the PARCEL tier (slice 2): it gets parcel
  // summaries + the ungrouped seats (which have no box to live in) and streams
  // a parcel's seats on demand. The schematic canvas still needs every row.
  const needsItems = tab === 'schematic'
  const parcelTier = tab === 'inventory'

  const [siteRow, counts, parcelSummary] = await Promise.all([
    prisma.site.findFirst({
      where: { id: params.id },
      include: {
        workingHours: true,
        ...(needsItems || parcelTier
          ? {
              inventoryItems: {
                // Parcel tier: ungrouped seats only — every grouped seat is
                // represented by its ParcelSummary until the user opens it.
                ...(parcelTier ? { where: { group: { lte: 0 } } } : {}),
                orderBy: { number: 'asc' as const },
                select: INVENTORY_ITEM_SELECT,
              },
            }
          : {}),
        layoutElements: true,
        products: {
          where: { active: true }
        }
      }
    }),
    getSiteItemCounts(params.id),
    parcelTier ? getParcelSummaries(params.id) : Promise.resolve(null),
  ])
  site = siteRow as SiteProps | null
  if (site) {
    site.itemCount = counts.itemCount
    site.activeItemCount = counts.activeItemCount
    site.availableTodayCount = counts.availableTodayCount
    if (!needsItems && !parcelTier) site.inventoryItems = []
    if (parcelSummary) {
      site.parcels = parcelSummary.parcels
      site.ungroupedCount = parcelSummary.ungroupedCount
    }
  }
  
  if (!site) return <ErrorCard title="Site not found" message="This site does not exist or has been removed." />

  // Resolve service fees and surface partner Mollie state for the header.
  if (site.userId) {
    const ctx = await getSiteFeeContext(params.id)
    ;(site as any).subscriptionTier = ctx.tier
    ;(site as any).subscriptionFeatures = ctx.features
    ;(site as any).mollieOnboardingStatus = ctx.partnerAccount?.mollieOnboardingStatus ?? null
    ;(site as any).hasMollieToken = !!ctx.partnerAccount?.mollieAccessToken

    const serviceCodes = ['sunbed-rental', 'food-and-beverage', 'equipment-rental']
    site.serviceFees = serviceCodes
      .map(code => resolveServiceFee(
        ctx.site.serviceFees,
        ctx.partnerAccount?.serviceFees ?? [],
        ctx.settings?.serviceFees ?? [],
        code,
        ctx.tier,
      ))
      .filter(Boolean) as any
    // Base plan fees — resolved WITHOUT site/account overrides — so the price
    // preview can show the partner's standard tier fee struck through when a
    // custom (site/account) rate applies.
    ;(site as any).baseServiceFees = serviceCodes
      .map(code => resolveServiceFee(
        [],
        [],
        ctx.settings?.serviceFees ?? [],
        code,
        ctx.tier,
      ))
      .filter(Boolean)
  }

  const sudoUsers = await prisma.user.findMany({
    where: {
      sudo: true
    }
  })
  const sudoUserEmails = sudoUsers.map(user => user.email)
  
  if (
    (site.userId && site.userId !== session.user.id) &&
    !sudoUserEmails.includes(session.user.email)
  ) {
    return <ErrorCard title="Not authorized" message="You don't have access to this site." />
  }
  
  return (
    <div className="container mx-auto max-w-[768px]">
      <SiteView site={site} apiKey={apiKey} tab={tab}>
        { children }
      </SiteView>
    </div>
  )

}