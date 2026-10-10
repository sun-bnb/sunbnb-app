import prisma from '@repo/data/PrismaCient'
import ErrorCard from '@/components/ErrorCard'
import { validateManageToken } from '../token'
import { siteDayKey } from '@repo/data/site-day'
import DayCloseView from '../DayCloseView'

export default async function ManageClosePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string }>
}) {
  const { id } = await params
  const { key } = await searchParams

  const result = await validateManageToken(id, key)
  if (!result.ok) {
    return (
      <ErrorCard
        title={result.error.title}
        message={result.error.message}
        showBackLink={false}
      />
    )
  }

  if (!result.isAdmin) {
    return (
      <ErrorCard
        title="Admin access required"
        message="This page is only accessible with an admin token."
        showBackLink={false}
      />
    )
  }

  // Resolve venue-local today as YYYY-MM-DD (same approach as sunbeds/page.tsx).
  const siteMeta = await prisma.site.findFirst({
    where: { id },
    select: { timeZone: true, locationLat: true, locationLng: true },
  })

  const todayIso = siteDayKey({
    timeZone: siteMeta?.timeZone,
    latitude: siteMeta?.locationLat ? parseFloat(siteMeta.locationLat) : undefined,
    longitude: siteMeta?.locationLng ? parseFloat(siteMeta.locationLng) : undefined,
  })

  const backHref = `/sites/${id}/manage?key=${key}`

  return (
    <DayCloseView
      siteId={result.site.id}
      accessKey={key!}
      siteName={result.site.name}
      todayIso={todayIso}
      backHref={backHref}
    />
  )
}
