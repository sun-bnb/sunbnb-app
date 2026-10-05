import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { LEAD_TOKEN_RE, parseLeadLayout } from '@repo/data/lead-model'
import { getLeadMockup } from '@repo/data/leads'
import MockupWorkspace from '@/components/MockupWorkspace'
import TrackOnMount from '@/components/TrackOnMount'
import { offerFor } from '@/lib/offer.ts'
import { localeOrDefault } from '@/lib/places.ts'
import { getLocale } from 'next-intl/server'
import { SiteFooter, SiteHeader } from '@/components/SiteChrome'

export const dynamic = 'force-dynamic'

/**
 * /m/<token> — a prospect's saved beach mockup (track 027 P3). The token is the only key and the
 * page is public to whoever holds the link, so it renders the beach and layout only:
 * `getLeadMockup` never selects contact data.
 */
export default async function MockupPage({
  params,
  searchParams,
}: {
  params: { token: string }
  searchParams: Record<string, string | string[] | undefined>
}) {
  if (!LEAD_TOKEN_RE.test(params.token)) notFound()
  const lead = await getLeadMockup(params.token)
  if (!lead) notFound()
  const t = await getTranslations()

  const saved = parseLeadLayout({
    anchorLat: lead.layoutAnchorLat,
    anchorLng: lead.layoutAnchorLng,
    seaBearingDeg: lead.layoutSeaBearing,
    placement: lead.layoutPlacement,
  })

  return (
    <>
      <SiteHeader />
      {/* mockup_created is recorded server-side in createMockup; here only the ad pixel fires. */}
      <TrackOnMount
        context={{ token: lead.token, angle: lead.angle, variant: lead.variant }}
        name={searchParams.new === '1' ? 'mockup_created' : undefined}
        beacon={false}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{lead.beachName}</h1>
            <p className="text-sm text-gray-500">
              {lead.beachAddress} · {t('Beach.sunbeds', { count: lead.sunbedCount })}
            </p>
          </div>
          <Link href="/" className="btn-ghost">
            {t('Beach.change')}
          </Link>
        </div>

        {/* Client key only — never fall back to the server key, which would ship it in the HTML. */}
        <MockupWorkspace
          token={lead.token}
          apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY ?? ''}
          center={{ lat: lead.lat, lng: lead.lng }}
          initialSunbedCount={lead.sunbedCount}
          saved={saved}
          beachName={lead.beachName}
          shareHint={t('Mockup.shareHint')}
          // The chat only appears where it can work; without a key the page is form-only (D1).
          chatEnabled={Boolean(process.env.ANTHROPIC_API_KEY)}
          variant={lead.variant === 'b' ? 'b' : 'a'}
          offer={offerFor(localeOrDefault(await getLocale()))}
        />
      </main>
      <SiteFooter />
    </>
  )
}
