import { auth } from '@/app/auth'
import { canCreateSite } from '@repo/data/subscription'
import { getPartnerFeeContext, resolveServiceFee } from '@repo/data/payment'
import CreateSiteWizard from './create-site-wizard'

export default async function CreateSitePage() {

  const session = await auth()
  if (!session?.user) return null

  const apiKey = process.env.GOOGLE_MAPS_API_KEY as string
  const siteLimit = await canCreateSite(session.user.id!)

  // Do not hard-redirect here — doing so also fires when the server re-renders
  // after the createSite action (the site was just created, limit now reached),
  // which would dismiss the Done step. Guard is enforced in the wizard instead.

  // Resolve the sunbed-rental fee for the price-breakdown preview. There's no
  // site yet, so we use the partner-only context (matches by country).
  const ctx = await getPartnerFeeContext(session.user.id!)
  const tier = ctx.tier ?? 'STARTER'
  const serviceFee = resolveServiceFee(
    [],
    ctx.partnerAccount?.serviceFees ?? [],
    ctx.settings?.serviceFees ?? [],
    'sunbed-rental',
    tier,
  ) ?? null

  // Base plan fee — resolved WITHOUT account/site overrides — so the preview can
  // strike it through when a custom rate applies.
  const baseServiceFee = resolveServiceFee(
    [],
    [],
    ctx.settings?.serviceFees ?? [],
    'sunbed-rental',
    tier,
  ) ?? null

  // Serialize fee data for the client
  const feeData = serviceFee ? {
    chargeType: serviceFee.chargeType,
    feeAmount: serviceFee.feeAmount,
    percentage: serviceFee.percentage,
    serviceCode: serviceFee.serviceCode,
    overridden: serviceFee.accountId != null || serviceFee.siteId != null,
  } : null

  const baseFeeData = baseServiceFee ? {
    chargeType: baseServiceFee.chargeType,
    feeAmount: baseServiceFee.feeAmount,
    percentage: baseServiceFee.percentage,
    serviceCode: baseServiceFee.serviceCode,
  } : null

  return (
    <div className="container mx-auto max-w-[768px]">
      <CreateSiteWizard
        apiKey={apiKey}
        tier={tier}
        serviceFee={feeData}
        baseServiceFee={baseFeeData}
        allowed={siteLimit.allowed}
        features={ctx.features ?? null}
      />
    </div>
  )
}
