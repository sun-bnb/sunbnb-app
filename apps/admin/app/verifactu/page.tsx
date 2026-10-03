import { auth } from '@/app/auth'
import prisma from '@repo/data/PrismaCient'
import { redirect } from 'next/navigation'
import {
  getVerifactuHealth,
  describeVerifactuHealth,
  getPartnerGrantStatuses,
} from '@repo/data/tax/es-verifactu/health'
import {
  getCertificateStatus,
  describeCertificateStatus,
} from '@repo/data/tax/es-verifactu/certificate'
import { findRecordsNeedingSubsanacion } from '@repo/data/tax/es-verifactu/subsanacion'
import { resolveAeatMode, resolveAeatEnvironment } from '@repo/data/tax/es-verifactu/client'

/**
 * Veri*factu operations (track 026 P9).
 *
 * Sudo-gated, like every admin screen. Read-only on purpose: everything that
 * changes a filing — correcting a record, voiding one — is a judgement call and
 * lives behind a deliberate CLI (`verifactu:subsanar`, `verifactu:anular`), not
 * behind a button someone can hit while scanning a dashboard.
 *
 * What it exists to make visible, because nothing else does:
 *
 *  - **Invoices with no record.** Phase 5 writes NO record for an invoice it
 *    cannot file, so absence is the representation and this is the only thing
 *    that observes it.
 *  - **Records AEAT accepted WITH ERRORS.** They read as `sent` everywhere else,
 *    and per the huella spec a wrong hash arrives exactly that way.
 *  - **Certificate expiry.** FNMT certificates last two years and CANNOT be
 *    renewed after expiry; a lapse fails at the TLS handshake, which looks like a
 *    network fault while records quietly queue.
 *  - **Spanish issuers with no province set**, whose invoices are silently out of
 *    scope rather than filed.
 */
export const dynamic = 'force-dynamic'

export default async function VerifactuOpsPage() {
  const session = await auth()
  if (!session?.user) redirect('/api/auth/signin')
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sudo: true },
  })
  if (!user?.sudo) redirect('/')

  const [health, candidates, grants] = await Promise.all([
    getVerifactuHealth(),
    findRecordsNeedingSubsanacion(),
    getPartnerGrantStatuses(),
  ])
  const ungranted = grants.filter((g) => g.state !== 'complete')
  const cert = getCertificateStatus()
  const mode = resolveAeatMode(process.env)
  const environment = resolveAeatEnvironment(process.env)

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-lg font-semibold text-gray-100 mb-1">Veri*factu</h1>
      <p className="text-xs text-gray-500 mb-6">
        Spanish fiscal records — AEAT submission, chain integrity and certificate status.
      </p>

      <Banner ok={health.healthy}>{describeVerifactuHealth(health)}</Banner>

      {/* ── Transport ─────────────────────────────────────────── */}
      <Section title="Transport">
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Mode" value={mode} muted={mode === 'stub'} />
          <Stat label="Environment" value={environment} muted={environment === 'pruebas'} />
          <Stat
            label="Certificate"
            value={
              !cert.configured
                ? 'none'
                : cert.error
                  ? 'unreadable'
                  : cert.expired
                    ? 'EXPIRED'
                    : `${cert.daysRemaining}d left`
            }
            muted={!cert.configured}
            alert={Boolean(cert.error || cert.expired || cert.expiringSoon)}
          />
        </div>
        <p className="text-xs text-gray-500 mt-3">{describeCertificateStatus(cert)}</p>
        {cert.subject && (
          <p className="text-xs text-gray-600 mt-1">
            {cert.subject} &middot; issued by {cert.issuer}
          </p>
        )}
        {mode === 'stub' && (
          <p className="text-xs text-amber-400 mt-2">
            Stub mode: records are generated and queued but nothing reaches AEAT.
          </p>
        )}
      </Section>

      {/* ── Records ───────────────────────────────────────────── */}
      <Section title="Records">
        {Object.keys(health.recordsByStatus).length === 0 ? (
          <p className="text-xs text-gray-500">No records yet.</p>
        ) : (
          <div className="flex gap-4 flex-wrap">
            {Object.entries(health.recordsByStatus)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([status, n]) => (
                <Stat
                  key={status}
                  label={status}
                  value={String(n)}
                  alert={status === 'blocked' || status === 'error'}
                  muted={status === 'sent'}
                />
              ))}
          </div>
        )}
        {health.oldestUnsentAt && (
          <p className="text-xs text-gray-500 mt-3">
            Oldest unsent: {health.oldestUnsentAt.toISOString()}. A queue is normal — AEAT
            treats it as an incident, not a breach — but one that stops draining is not.
          </p>
        )}
      </Section>

      {/* ── Chains ────────────────────────────────────────────── */}
      <Section title="Chains">
        {health.chains.length === 0 ? (
          <p className="text-xs text-gray-500">No chains yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left py-1.5">Issuer NIF</th>
                <th className="text-right py-1.5">Records</th>
                <th className="text-right py-1.5">Chain head</th>
                <th className="text-right py-1.5">Integrity</th>
              </tr>
            </thead>
            <tbody>
              {health.chains.map((c) => (
                <tr key={c.issuerNif} className="border-b border-gray-900">
                  <td className="py-1.5 text-gray-200">{c.issuerNif}</td>
                  <td className="py-1.5 text-right text-gray-400">{c.recordCount}</td>
                  <td className="py-1.5 text-right text-gray-400">{c.lastChainSeq}</td>
                  <td
                    className={`py-1.5 text-right font-medium ${c.contiguous ? 'text-green-400' : 'text-red-400'}`}
                  >
                    {c.contiguous ? 'intact' : 'GAP'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-gray-600 mt-2">
          A gap means a record counted into the chain no longer exists. Re-sending cannot
          repair it.
        </p>
      </Section>

      {/* ── Needs attention ───────────────────────────────────── */}
      {health.unfiled.length > 0 && (
        <Section title={`Invoices with NO record (${health.unfiled.length})`} alert>
          <table className="w-full text-xs">
            <tbody>
              {health.unfiled.slice(0, 50).map((inv) => (
                <tr key={inv.invoiceId} className="border-b border-gray-900">
                  <td className="py-1.5 text-gray-200">{inv.invoiceNumber ?? '(no number)'}</td>
                  <td className="py-1.5 text-gray-500">{inv.issuerType}</td>
                  <td className="py-1.5 text-gray-500">{inv.issuerNif ?? '(no nif)'}</td>
                  <td className="py-1.5 text-right text-gray-500">
                    {inv.invoicedAt.toISOString().slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-500 mt-2">
            These are Spanish invoices we are obliged to have filed. The reason each was
            refused is in the application log at issue time.
          </p>
        </Section>
      )}

      {candidates.length > 0 && (
        <Section title={`May need correcting (${candidates.length})`} alert>
          <table className="w-full text-xs">
            <tbody>
              {candidates.slice(0, 50).map((c) => (
                <tr key={c.invoiceId} className="border-b border-gray-900 align-top">
                  <td className="py-1.5 text-gray-200 whitespace-nowrap">{c.invoiceNumber}</td>
                  <td className="py-1.5 text-gray-500 whitespace-nowrap">{c.status}</td>
                  <td className="py-1.5 text-gray-400">{c.lastError}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-500 mt-2">
            A <code>sent</code> row with an error is the important one: AEAT holds that record
            and flagged defects in it. Fix the underlying data, then{' '}
            <code>npm run verifactu:subsanar:production -- --invoice &lt;id&gt;</code>.
          </p>
        </Section>
      )}

      {health.unresolvedEsIssuers.length > 0 && (
        <Section title="Spanish issuers with no province set" alert>
          <table className="w-full text-xs">
            <tbody>
              {health.unresolvedEsIssuers.map((i) => (
                <tr key={i.issuerNif ?? 'none'} className="border-b border-gray-900">
                  <td className="py-1.5 text-gray-200">{i.issuerNif ?? '(no nif)'}</td>
                  <td className="py-1.5 text-right text-gray-400">
                    {i.invoiceCount} invoice(s) out of scope
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-500 mt-2">
            Not counted as unfiled — an unclassified issuer never owed a record, which is
            exactly why it needs its own figure. Set the province on the partner&rsquo;s Tax
            Identity card.
          </p>
        </Section>
      )}

      {grants.length > 0 && (
        <Section
          title={`Partner authorisations (${grants.length - ungranted.length}/${grants.length})`}
          alert={ungranted.length > 0}
        >
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left py-1.5">Partner</th>
                <th className="text-left py-1.5">Tax id</th>
                <th className="text-left py-1.5">Authorisation</th>
                <th className="text-right py-1.5">Records waiting</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.userId} className="border-b border-gray-900">
                  <td className="py-1.5 text-gray-200">{g.company}</td>
                  <td className="py-1.5 text-gray-500">{g.businessId ?? '—'}</td>
                  <td
                    className={`py-1.5 font-medium ${
                      g.state === 'complete'
                        ? 'text-green-400'
                        : g.state === 'invoicing-only'
                          ? 'text-amber-400'
                          : 'text-red-400'
                    }`}
                  >
                    {g.state === 'complete'
                      ? 'complete'
                      : g.state === 'invoicing-only'
                        ? 'invoicing only'
                        : 'none'}
                  </td>
                  <td className="py-1.5 text-right text-gray-400">
                    {g.queuedRecords > 0 ? g.queuedRecords : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-500 mt-2">
            Spanish partners only. Without the AEAT submission grant their records are
            generated and held, never sent — AEAT refuses a submission from a colaborador
            social who was not previously authorised. Partners grant it themselves at{' '}
            <code>/account/verifactu</code> in the partner app.
          </p>
          {grants.some((g) => g.state === 'none') && (
            <p className="text-xs text-amber-400 mt-2">
              A partner showing <strong>none</strong> has given no mandate at all, yet we are
              already issuing invoices in their name. That is the one to chase first.
            </p>
          )}
        </Section>
      )}

      {health.platformInvoicesWithoutIssuerId > 0 && (
        <Section title="Our own invoices with no tax id">
          <p className="text-xs text-gray-400">
            {health.platformInvoicesWithoutIssuerId} PLATFORM invoice(s) carry no issuer tax
            id. Historical, cleared by the cutover deletion — but this count must never grow.
          </p>
        </Section>
      )}
    </div>
  )
}

function Banner({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 mb-6 text-sm ${
        ok
          ? 'border-green-500/30 bg-green-500/5 text-green-300'
          : 'border-amber-500/30 bg-amber-500/5 text-amber-300'
      }`}
    >
      {children}
    </div>
  )
}

function Section({
  title,
  alert,
  children,
}: {
  title: string
  alert?: boolean
  children: React.ReactNode
}) {
  return (
    <section className="mb-6">
      <h2
        className={`text-sm font-semibold mb-2 ${alert ? 'text-amber-300' : 'text-gray-200'}`}
      >
        {title}
      </h2>
      <div className="border border-gray-800 rounded-lg bg-gray-900 p-4">{children}</div>
    </section>
  )
}

function Stat({
  label,
  value,
  muted,
  alert,
}: {
  label: string
  value: string
  muted?: boolean
  alert?: boolean
}) {
  return (
    <div>
      <div className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">{label}</div>
      <div
        className={`text-lg font-semibold ${
          alert ? 'text-amber-400' : muted ? 'text-gray-400' : 'text-gray-100'
        }`}
      >
        {value}
      </div>
    </div>
  )
}
