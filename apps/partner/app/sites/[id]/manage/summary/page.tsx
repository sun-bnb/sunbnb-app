import prisma from '@repo/data/PrismaCient'
import { siteDayKey } from '@repo/data/site-day'
import ErrorCard from '@/components/ErrorCard'
import DailySummaryView from '../DailySummaryView'
import { validateManageToken } from '../token'


export default async function ManageSummaryPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { [key: string]: string }
}) {
  const { key } = searchParams

  const result = await validateManageToken(params.id, key)
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

  // Resolve venue-local today as YYYY-MM-DD server-side (track 017 P4), mirroring
  // manage/close/page.tsx — the daily summary's day-report window must anchor to
  // the venue's civil day, not the browser/server clock.
  const siteMeta = await prisma.site.findFirst({
    where: { id: params.id },
    select: { timeZone: true, locationLat: true, locationLng: true },
  })

  const todayIso = siteDayKey({
    timeZone: siteMeta?.timeZone,
    latitude: siteMeta?.locationLat ? parseFloat(siteMeta.locationLat) : undefined,
    longitude: siteMeta?.locationLng ? parseFloat(siteMeta.locationLng) : undefined,
  })

  const backHref = `/sites/${params.id}/manage?key=${key}`

  return (
    <DailySummaryView
      siteId={result.site.id}
      accessKey={key!}
      siteName={result.site.name}
      backHref={backHref}
      todayIso={todayIso}
    />
  )
}
