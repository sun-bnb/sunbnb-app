import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getLeadForAdmin } from '@repo/data/leads'
import { STATUS_STYLES, statusLabel, scoreStyle, humanizeEvent, MARKETING_URL } from '../format'
import StatusChanger from './StatusChanger'

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const asObjs = (v: unknown): Json[] => (Array.isArray(v) ? (v as unknown[]).filter(isObj) : [])
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const eur = (v: unknown) => {
  const n = num(v)
  return n === null ? '—' : `€${n.toLocaleString('en', { maximumFractionDigits: 2 })}`
}
const dt = (d: Date | null | undefined) =>
  d ? d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : '—'

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-gray-800 rounded-lg p-4 bg-gray-900/30">
      <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">{title}</h3>
      {children}
    </section>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-0.5 text-sm">
      <dt className="text-gray-500">{k}</dt>
      <dd className="text-gray-200 text-right break-all">{v ?? '—'}</dd>
    </div>
  )
}

type ChatMsg = { role?: string; content?: unknown }

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const session = await auth()
  if (!session?.user) redirect('/api/auth/signin')
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { sudo: true } })
  if (!user?.sudo) redirect('/')

  const lead = await getLeadForAdmin(id)
  if (!lead) notFound()

  const projection = isObj(lead.projection) ? lead.projection : null
  const input = projection && isObj(projection.input) ? projection.input : null
  const tiers = asObjs(projection?.tiers)
  const cheapest = projection?.cheapest
  const cheapestLabel = isObj(cheapest) ? String(cheapest.name ?? '') : typeof cheapest === 'string' ? cheapest : null

  const rawSessions = isObj(lead.chatSessions) && isObj(lead.chatSessions.sessions) ? lead.chatSessions.sessions : {}
  const sessions = Object.entries(rawSessions)
    .map(([sid, msgs]) => ({
      sid,
      msgs: (Array.isArray(msgs) ? (msgs as ChatMsg[]) : []).filter(
        (m) =>
          (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim() !== '',
      ),
    }))
    .filter((s) => s.msgs.length > 0)

  const runs = lead.runs.filter((r) => r !== 'none')

  return (
    <div className="container mx-auto max-w-5xl p-4">
      <Link href="/leads" className="text-xs text-gray-500 hover:text-gray-300">
        ← Leads
      </Link>

      <div className="mt-3 mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-100">{lead.beachName}</h2>
          <p className="text-sm text-gray-500">
            {lead.beachAddress} · {lead.sunbedCount} sunbeds
          </p>
          <a
            href={`${MARKETING_URL}/m/${lead.token}`}
            target="_blank"
            rel="noreferrer"
            className="inline-block mt-2 text-sm text-blue-400 hover:underline"
          >
            Open their mockup ↗
          </a>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-2 py-0.5 rounded border text-xs ${STATUS_STYLES[lead.status] ?? STATUS_STYLES.mockup}`}>
            {statusLabel(lead.status)}
          </span>
          <StatusChanger id={lead.id} current={lead.status} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Score">
          <div className="flex items-center gap-3 mb-2">
            <span className={`px-2 py-0.5 rounded border text-sm font-semibold ${scoreStyle(lead.score.score)}`}>
              {lead.score.score}
            </span>
            <span className="text-xs text-gray-500">of 100</span>
          </div>
          <ul className="text-sm text-gray-300 space-y-0.5">
            {lead.score.reasons.map((r) => (
              <li key={r.label} className="flex justify-between">
                <span>{r.label}</span>
                <span className="text-gray-500 tabular-nums">+{r.points}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Contact">
          <dl>
            <Row k="Name" v={lead.contactName} />
            <Row k="Business" v={lead.businessName} />
            <Row k="Type" v={lead.businessType} />
            <Row
              k="Email"
              v={lead.email ? <a className="text-blue-400 hover:underline" href={`mailto:${lead.email}`}>{lead.email}</a> : null}
            />
            <Row
              k="Phone"
              v={lead.phone ? <a className="text-blue-400 hover:underline" href={`tel:${lead.phone}`}>{lead.phone}</a> : null}
            />
          </dl>
          {lead.message && (
            <p className="mt-2 text-sm text-gray-300 whitespace-pre-wrap border-t border-gray-800 pt-2">{lead.message}</p>
          )}
        </Card>

        <Card title="Their numbers">
          {!projection ? (
            <p className="text-sm text-gray-500">No projection yet.</p>
          ) : (
            <>
              <dl className="mb-3">
                <Row k="Price" v={eur(input?.price)} />
                <Row k="Sunbeds" v={num(input?.sunbeds) ?? '—'} />
                <Row k="Online / day (their estimate)" v={num(input?.onlinePerDay) === null ? '—' : num(input?.onlinePerDay)} />
                <Row k="Online / month" v={eur(projection.monthlyOnline)} />
                <Row k="Cheapest plan" v={cheapestLabel || '—'} />
              </dl>
              {tiers.length > 0 && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 text-left">
                      <th className="py-1 font-medium">Plan</th>
                      <th className="py-1 font-medium">Fee</th>
                      <th className="py-1 font-medium">Comm.</th>
                      <th className="py-1 font-medium">Keep/bed</th>
                      <th className="py-1 font-medium">Break-even</th>
                      <th className="py-1 font-medium">Cost/mo</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-300">
                    {tiers.map((t, i) => (
                      <tr key={i} className="border-t border-gray-800">
                        <td className="py-1">{String(t.name ?? '—')}</td>
                        <td className="py-1">{eur(t.monthlyPrice)}</td>
                        <td className="py-1">{num(t.commissionPercent) === null ? '—' : `${t.commissionPercent}%`}</td>
                        <td className="py-1">{eur(t.keepPerBed)}</td>
                        <td className="py-1">{num(t.breakEvenBedDays) === null ? '—' : `${t.breakEvenBedDays} bed-days`}</td>
                        <td className="py-1">{eur(t.monthlyCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </Card>

        <Card title="What they run">
          {runs.length === 0 ? (
            <p className="text-sm text-gray-500">{lead.runs.length === 0 ? 'Not answered' : 'Sunbeds only'}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {runs.map((r) => (
                <span key={r} className="px-2 py-0.5 rounded bg-gray-800 text-gray-300 text-xs">
                  {r}
                </span>
              ))}
            </div>
          )}
        </Card>

        <Card title={`Funnel (${lead.events.length})`}>
          {lead.events.length === 0 ? (
            <p className="text-sm text-gray-500">No events.</p>
          ) : (
            <ol className="text-sm space-y-0.5 max-h-72 overflow-y-auto">
              {lead.events.map((e, i) => (
                <li key={i} className="flex justify-between gap-4">
                  <span className="text-gray-200">{humanizeEvent(e.name)}</span>
                  <span className="text-gray-500 text-xs whitespace-nowrap">{dt(e.createdAt)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="Source & consent">
          <dl>
            <Row k="UTM source" v={lead.utmSource} />
            <Row k="UTM medium" v={lead.utmMedium} />
            <Row k="UTM campaign" v={lead.utmCampaign} />
            <Row k="UTM term" v={lead.utmTerm} />
            <Row k="UTM content" v={lead.utmContent} />
            <Row k="Angle" v={lead.angle} />
            <Row k="Variant" v={lead.variant} />
            <Row k="gclid" v={lead.gclid ? 'present' : 'none'} />
            <Row k="fbclid" v={lead.fbclid ? 'present' : 'none'} />
            <Row k="Locale" v={lead.locale} />
            <Row k="Created" v={dt(lead.createdAt)} />
            <Row k="Last activity" v={dt(lead.lastActivityAt)} />
            <Row k="Demo requested" v={dt(lead.demoRequestedAt)} />
            <Row k="Contact consent" v={lead.consentAt ? `${dt(lead.consentAt)} (${lead.consentVersion ?? '?'})` : 'none'} />
            <Row k="Marketing cookies" v={dt(lead.marketingConsentAt)} />
          </dl>
        </Card>
      </div>

      <div className="mt-4">
        <Card title="AI chat transcript">
          {sessions.length === 0 ? (
            <p className="text-sm text-gray-500">No chat.</p>
          ) : (
            <div className="space-y-5">
              {sessions.map((s, i) => (
                <div key={s.sid}>
                  <p className="text-xs text-gray-600 mb-2">Session {i + 1}</p>
                  <div className="space-y-2">
                    {s.msgs.map((m, j) => {
                      const mine = m.role === 'user'
                      return (
                        <div key={j} className={`flex ${mine ? 'justify-start' : 'justify-end'}`}>
                          <div
                            className={`max-w-[80%] rounded-lg px-3 py-1.5 text-sm whitespace-pre-wrap ${
                              mine ? 'bg-gray-800 text-gray-100' : 'bg-blue-950/40 border border-blue-900 text-blue-100'
                            }`}
                          >
                            {m.content as string}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
