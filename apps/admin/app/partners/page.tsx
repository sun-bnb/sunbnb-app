import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function PartnersPage() {
  const session = await auth()
  if (!session?.user) redirect('/api/auth/signin')

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sudo: true },
  })
  if (!user?.sudo) redirect('/')

  const partners = await prisma.partnerAccount.findMany({
    select: {
      userId: true,
      company: true,
      firstName: true,
      lastName: true,
      user: { select: { email: true } },
      subscription: {
        include: { plan: true },
      },
      customSubscription: true,
      serviceFees: {
        where: { accountId: { not: null } },
        select: { id: true, accountId: true },
      },
      _count: {
        select: { settlements: true },
      },
    },
    orderBy: { company: 'asc' },
  })

  // Count sites per partner in bulk
  const siteCountMap = await prisma.site
    .groupBy({ by: ['userId'], _count: { _all: true } })
    .then((rows) => new Map(rows.map((r) => [r.userId, r._count._all])))

  return (
    <div className="container mx-auto max-w-[768px] p-4">
      <div className="mt-4 mb-6">
        <h2 className="text-lg font-semibold text-gray-100">Partners</h2>
        <p className="text-sm text-gray-500 mt-1">
          Platform partner accounts — click a row to view and manage custom subscription terms.
        </p>
      </div>

      {partners.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
          <p className="text-sm">No partner accounts found</p>
        </div>
      ) : (
        <div className="border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/50">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Company
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Owner
                </th>
                <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Tier
                </th>
                <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Sites
                </th>
                <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Custom
                </th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => {
                const tier = p.subscription?.plan?.tier ?? 'STARTER'
                const siteCount = siteCountMap.get(p.userId) ?? 0
                const hasCustom =
                  p.customSubscription != null ||
                  p.serviceFees.some((f) => f.accountId === p.userId)
                const tierColor =
                  tier === 'BUSINESS'
                    ? 'bg-purple-400/20 text-purple-300'
                    : tier === 'PRO'
                      ? 'bg-blue-400/20 text-blue-300'
                      : 'bg-gray-700 text-gray-300'

                return (
                  <tr
                    key={p.userId}
                    className="border-b border-gray-800/50 last:border-0 hover:bg-gray-900/40 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/partners/${p.userId}`}
                        className="text-gray-200 hover:text-purple-300 font-medium transition-colors"
                      >
                        {p.company}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-400 text-xs">{p.user.email}</div>
                      {(p.firstName || p.lastName) && (
                        <div className="text-gray-600 text-xs mt-0.5">
                          {[p.firstName, p.lastName].filter(Boolean).join(' ')}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${tierColor}`}
                      >
                        {tier}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-gray-400">{siteCount}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {hasCustom ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-400/20 text-amber-300">
                          custom
                        </span>
                      ) : (
                        <span className="text-gray-700">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-gray-600">
        {partners.length} partner{partners.length !== 1 ? 's' : ''}
      </p>
    </div>
  )
}
