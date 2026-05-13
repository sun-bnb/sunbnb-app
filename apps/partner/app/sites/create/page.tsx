import { auth } from '@/app/auth'
import { canCreateSite } from '@repo/data/subscription'
import prisma from '@repo/data/PrismaCient'
import CreateSiteWizard from './create-site-wizard'

export default async function CreateSitePage() {

  const session = await auth()
  if (!session?.user) return null

  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string
  const siteLimit = await canCreateSite(session.user.id!)

  // Do not hard-redirect here — doing so also fires when the server re-renders
  // after the createSite action (the site was just created, limit now reached),
  // which would dismiss the Done step. Guard is enforced in the wizard instead.

  // Fetch service fees for price breakdown preview. Match Settings by the
  // partner's country (falling back to any row) — keep in sync with
  // packages/data/src/payment.ts:loadFeeContext.
  const partnerAccount = await prisma.partnerAccount.findUnique({
    where: { userId: session.user.id },
    include: {
      serviceFees: true,
      subscription: { include: { plan: true } },
    },
  })

  const settingsInclude = {
    serviceFees: { where: { siteId: null, accountId: null } },
  } as const
  const country = partnerAccount?.country
  let settings = country
    ? await prisma.settings.findFirst({ where: { country }, include: settingsInclude })
    : null
  if (!settings) {
    settings = await prisma.settings.findFirst({ include: settingsInclude })
  }

  const tier = partnerAccount?.subscription?.plan?.tier ?? 'STARTER'
  const platformFees = settings?.serviceFees ?? []

  // Resolve the sunbed-rental fee for this partner's tier
  const accountFee = partnerAccount?.serviceFees?.find(f => f.serviceCode === 'sunbed-rental')
  const tierFee = tier
    ? platformFees.find(f => f.serviceCode === 'sunbed-rental' && f.subscriptionTier === tier)
    : null
  const defaultFee = platformFees.find(f => f.serviceCode === 'sunbed-rental' && f.subscriptionTier === null)
  const serviceFee = accountFee ?? tierFee ?? defaultFee ?? null

  // Serialize fee data for the client
  const feeData = serviceFee ? {
    chargeType: serviceFee.chargeType,
    feeAmount: serviceFee.feeAmount,
    percentage: serviceFee.percentage,
    serviceCode: serviceFee.serviceCode,
  } : null

  return (
    <div className="container mx-auto max-w-[768px]">
      <CreateSiteWizard
        apiKey={apiKey}
        tier={tier}
        serviceFee={feeData}
        allowed={siteLimit.allowed}
      />
    </div>
  )
}
