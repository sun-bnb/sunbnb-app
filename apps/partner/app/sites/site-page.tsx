import prisma from '@repo/data/PrismaCient'
import { auth } from '@/app/auth'
import { SiteProps } from '@/types/shared'
import SiteView from './site-view'


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
      products: {
        where: { active: true }
      }
    } 
  })
  
  if (!site) return <div>Site {params.id} not found</div>

  // Resolve service fees: site → partnerAccount → global settings (tier-aware)
  if (site.userId) {
    const [siteWithFees, partnerAccount, settings] = await Promise.all([
      prisma.site.findUnique({ where: { id: params.id }, include: { serviceFees: true } }),
      prisma.partnerAccount.findUnique({
        where: { userId: site.userId },
        include: {
          serviceFees: true,
          subscription: { include: { plan: true } },
        },
      }),
      prisma.settings.findFirst({
        include: {
          serviceFees: { where: { siteId: null, accountId: null } },
        },
      }),
    ])

    const tier = partnerAccount?.subscription?.plan?.tier ?? null
    const platformFees = settings?.serviceFees ?? []
    ;(site as any).subscriptionTier = tier

    const serviceCodes = ['sunbed-rental', 'food-and-beverage']
    site.serviceFees = serviceCodes
      .map(code => {
        // 1. Site-level override
        const siteFee = siteWithFees?.serviceFees?.find(f => f.serviceCode === code)
        if (siteFee) return siteFee
        // 2. Account-level override
        const accountFee = partnerAccount?.serviceFees?.find(f => f.serviceCode === code)
        if (accountFee) return accountFee
        // 3. Platform-level: prefer tier-specific, fall back to default (null tier)
        const tierFee = tier
          ? platformFees.find(f => f.serviceCode === code && f.subscriptionTier === tier)
          : null
        if (tierFee) return tierFee
        return platformFees.find(f => f.serviceCode === code && f.subscriptionTier === null)
      })
      .filter(Boolean) as any
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
    return <div>Site not found</div>
  }
  
  return (
    <div className="container mx-auto max-w-[768px]">
      <SiteView site={site} apiKey={apiKey} tab={tab}>
        { children }
      </SiteView>
    </div>
  )

}