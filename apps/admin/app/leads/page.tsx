import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { listLeadsForAdmin } from '@repo/data/leads'
import { LEAD_STATUS } from '@repo/data/lead-model'
import { STATUS_STYLES, statusLabel, scoreStyle, relativeTime } from './format'

type Search = { status?: string; contact?: string; q?: string }

const TH = 'text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide'

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await auth()
  if (!session?.user) redirect('/api/auth/signin')

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sudo: true },
  })
  if (!user?.sudo) redirect('/')

  const sp = await searchParams
  const status = Object.values(LEAD_STATUS).includes(sp.status as never) ? sp.status : undefined
  const onlyContact = sp.contact === '1'
  const q = sp.q?.trim() || undefined
  const leads = await listLeadsForAdmin({ status, onlyContact, q })

  return (
    <div className="container mx-auto max-w-6xl p-4">
      <div className="mt-4 mb-4">
        <h2 className="text-lg font-semibold text-gray-100">Leads</h2>
        <p className="text-sm text-gray-500 mt-1">
          Beach businesses from try.sunbnb.app — newest activity first, up to 200.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-center gap-3 mb-4 text-sm">
        <select
          name="status"
          defaultValue={status ?? ''}
          aria-label="Status"
          className="bg-gray-900 border border-gray-800 rounded-md px-2 py-1.5 text-gray-200"
        >
          <option value="">All statuses</option>
          {Object.values(LEAD_STATUS).map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-gray-400">
          <input type="checkbox" name="contact" value="1" defaultChecked={onlyContact} />
          Only with contact
        </label>
        <input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Beach, name, email…"
          aria-label="Search"
          className="bg-gray-900 border border-gray-800 rounded-md px-3 py-1.5 text-gray-200 placeholder-gray-600 w-60"
        />
        <button type="submit" className="px-3 py-1.5 rounded-md bg-gray-800 text-gray-200 hover:bg-gray-700">
          Filter
        </button>
        {(status || onlyContact || q) && (
          <Link href="/leads" className="text-gray-500 hover:text-gray-300">
            Clear
          </Link>
        )}
      </form>

      {leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
          <p className="text-sm">No leads match these filters</p>
        </div>
      ) : (
        <div className="border border-gray-800 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/50">
                <th className={TH}>Score</th>
                <th className={TH}>Beach</th>
                <th className={TH}>Beds</th>
                <th className={TH}>Runs</th>
                <th className={TH}>Status</th>
                <th className={TH}>Contact</th>
                <th className={TH}>Source</th>
                <th className={TH}>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => {
                const href = `/leads/${l.id}`
                const reasons = l.score.reasons.map((r) => `+${r.points} ${r.label}`).join('\n')
                const source = [l.utmSource, l.utmCampaign].filter(Boolean).join(' / ')
                const meta = [l.angle && `angle ${l.angle}`, l.variant && `v ${l.variant}`].filter(Boolean).join(' · ')
                const runs = l.runs.filter((r) => r !== 'none')
                return (
                  <tr key={l.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-900/40 align-top">
                    <td className="px-3 py-2.5">
                      <Link href={href} title={reasons} className={`inline-block px-2 py-0.5 rounded-sm border text-xs font-semibold ${scoreStyle(l.score.score)}`}>
                        {l.score.score}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <Link href={href} className="text-gray-100 font-medium hover:underline">
                        {l.beachName}
                      </Link>
                      <div className="text-xs text-gray-500 max-w-[240px] truncate">{l.beachAddress}</div>
                    </td>
                    <td className="px-3 py-2.5 text-gray-300 tabular-nums">{l.sunbedCount}</td>
                    <td className="px-3 py-2.5">
                      {runs.length === 0 ? (
                        <span className="text-gray-600">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {runs.map((r) => (
                            <span key={r} className="px-1.5 py-0.5 rounded-sm bg-gray-800 text-gray-300 text-xs">
                              {r}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-block px-2 py-0.5 rounded-sm border text-xs ${STATUS_STYLES[l.status] ?? STATUS_STYLES.mockup}`}>
                        {statusLabel(l.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-300">
                      {l.contactName || l.email || l.phone ? (
                        <div className="space-y-0.5">
                          {l.contactName && <div>{l.contactName}</div>}
                          {l.email && <div className="text-xs text-gray-500">{l.email}</div>}
                          {l.phone && <div className="text-xs text-gray-500">{l.phone}</div>}
                        </div>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-400">
                      <div>{source || '—'}</div>
                      {meta && <div className="text-gray-600">{meta}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-400 whitespace-nowrap">{relativeTime(l.lastActivityAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
