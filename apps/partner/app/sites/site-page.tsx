import prisma from '@repo/data/PrismaCient'
import { getSiteFeeContext } from '@repo/data/payment'
import { resolveServiceFee } from '@repo/data/payment'
import { auth } from '@/app/auth'
import { SiteProps } from '@/types/shared'
import SiteView from './site-view'
import ErrorCard from '@/components/ErrorCard'


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

  site = await prisma.site.findFirst({
    where: { id: params.id },
    include: {
      workingHours: true,
      inventoryItems: {
        orderBy: { number: 'asc' },
        include: {
          reservations: {
            include: {
              user: { select: { id: true, email: true } }
            },
            orderBy: { from: 'asc' }
          },
          pair: true,
          pairedBy: true
        }
      },
      layoutElements: true,
      products: {
        where: { active: true }
      }
    }
  })
  
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