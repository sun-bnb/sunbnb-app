import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { LEAD_TOKEN_RE, parseLeadLayout } from '@repo/data/lead-model'
import { getLeadMockup } from '@repo/data/leads'
import Experience from '@/components/Experience'
import type { Run } from '@/lib/intent.ts'
import { SiteHeader } from '@/components/SiteChrome'
import { offerFor } from '@/lib/offer.ts'
import { localeOrDefault } from '@/lib/places.ts'

export const dynamic = 'force-dynamic'

/**
 * /m/<token> — a prospect's saved beach, reopened from its link (or reloaded after "Build"). The
 * same `Experience` as the landing page, resumed at the guest mission on their map (track 027
 * D11). The token is the only key and the page is public to whoever holds the link, so it
 * renders the beach and layout only: `getLeadMockup` never selects contact data.
 */
export default async function MockupPage({ params: paramsPromise }: { params: Promise<{ token: string }> }) {
  const params = await paramsPromise
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
    <main className="relative bg-[#fff5e1]">
      <SiteHeader overlay />
      {/* Client key only — never fall back to the server key, which would ship it in the HTML. */}
      <Experience
        apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_CLIENT_KEY ?? ''}
        title={t('Hero.title')}
        subtitle={t('Hero.subtitle')}
        offer={offerFor(localeOrDefault(await getLocale()))}
        angle={lead.angle}
        // The agent only appears where it can work; without a key the page is rules-only (D1).
        chatEnabled={Boolean(process.env.ANTHROPIC_API_KEY)}
        resume={{
          beach: { placeId: lead.placeId, name: lead.beachName, address: lead.beachAddress, lat: lead.lat, lng: lead.lng },
          count: lead.sunbedCount,
          token: lead.token,
          saved,
          variant: lead.variant,
          // Stored: [] = not answered, ['none'] = just sunbeds (track 027 D10).
          runs: lead.runs.length ? (lead.runs.filter((r) => r !== 'none') as Run[]) : null,
        }}
      />
    </main>
  )
}
