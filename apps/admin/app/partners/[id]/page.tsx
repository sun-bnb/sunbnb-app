import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { redirect, notFound } from 'next/navigation'
import {
  resolveEffectiveSubscription,
  SUBSCRIPTION_FEATURES,
  TIER_FEATURE_DEFAULTS,
  resolveEffectiveFeatures,
  type SubscriptionFeatureKey,
} from '@repo/data/subscription'
import { getFeesByAccount } from '../../fees/actions'
import PartnerDetailView from './view'

export default async function PartnerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const session = await auth()
  if (!session?.user) redirect('/api/auth/signin')

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sudo: true },
  })
  if (!user?.sudo) redirect('/')

  const partnerAccount = await prisma.partnerAccount.findUnique({
    where: { userId: id },
    select: {
      userId: true,
      company: true,
      firstName: true,
      lastName: true,
      country: true,
      subscription: {
        include: { plan: true },
      },
      customSubscription: true,
      user: { select: { email: true, name: true } },
    },
  })

  if (!partnerAccount) notFound()

  const [siteCount, serviceCodes, settings, accountFees] = await Promise.all([
    prisma.site.count({ where: { userId: id } }),
    prisma.serviceCode.findMany({ orderBy: { code: 'asc' } }),
    prisma.settings.findMany({ orderBy: { country: 'asc' } }),
    getFeesByAccount(id),
  ])

  const plan = partnerAccount.subscription?.plan ?? null
  const customSubscription = partnerAccount.customSubscription ?? null
  // Cast featureOverrides from Prisma JsonValue to the typed map at the DB boundary
  const featureOverrides = (customSubscription?.featureOverrides as Partial<Record<SubscriptionFeatureKey, boolean>> | null) ?? null
  const effectiveCustom = customSubscription
    ? { ...customSubscription, featureOverrides }
    : null
  const effective = resolveEffectiveSubscription(plan, effectiveCustom)
  const effectiveFeatures = resolveEffectiveFeatures(plan?.tier ?? null, featureOverrides)

  // Build the feature catalog rows for the view (plain serializable data)
  const featureCatalog = Object.values(SUBSCRIPTION_FEATURES).map((f) => ({
    key: f.key as SubscriptionFeatureKey,
    label: f.label,
    description: f.description,
    tierDefault: TIER_FEATURE_DEFAULTS[effective.tier]?.[f.key as SubscriptionFeatureKey] ?? false,
    effectiveValue: effectiveFeatures[f.key as SubscriptionFeatureKey],
    override: featureOverrides?.[f.key as SubscriptionFeatureKey] ?? null,
  }))

  return (
    <div className="container mx-auto max-w-[768px]">
      <PartnerDetailView
        accountId={id}
        company={partnerAccount.company}
        ownerEmail={partnerAccount.user.email}
        ownerName={partnerAccount.user.name}
        baseTier={effective.tier}
        baseMonthlyPrice={effective.monthlyPrice}
        basePlanMaxSites={plan?.maxSites ?? null}
        currentSiteCount={siteCount}
        customMaxSites={customSubscription?.maxSites ?? null}
        hasCustomSubscription={customSubscription != null}
        effectiveMaxSites={effective.maxSites}
        isCustomMaxSites={effective.isCustom}
        initialAccountFees={accountFees}
        settings={settings}
        serviceCodes={serviceCodes}
        featureCatalog={featureCatalog}
      />
    </div>
  )
}
