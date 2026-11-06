/**
 * Run the Veri*factu submission sweep once from a laptop — the preproducción gate
 * of track 026 ("health → sweep → health").
 *
 * WRITES: records it sends move to `sent` / `error` / `blocked`. Only for the
 * local and TEST databases, which pair with AEAT preproducción. There is
 * deliberately no `:production` script: `AEAT_ENV=production` is refused
 * anywhere but a Vercel production deployment (`aeatEnvironmentMismatch`), so
 * production filing only ever happens through the admin cron.
 *
 * The certificate comes from the environment of THIS process only — never a
 * file in the repo:
 *   AEAT_CERT_PFX_BASE64=… AEAT_CERT_PASSWORD=… AEAT_MODE=http AEAT_ENV=pruebas \
 *     npm run verifactu:submit:test
 *
 * Default scope is our own commission invoices (`submitPlatformRecords`), the one
 * sweep that needs no Convenio and no partner grant. `--all` sweeps every
 * authorised issuer, as the cron does.
 *
 * Exit codes: 0 ran, 1 failed or nothing was sent because transmission is off.
 */
import prisma from '../index'
import { submitPendingRecords, submitPlatformRecords } from '../src/tax/es-verifactu/submit'

async function main() {
  const all = process.argv.includes('--all')
  const result = all ? await submitPendingRecords() : await submitPlatformRecords()

  if (result.paused) {
    console.error(
      'Transmission is off (no AEAT_CERT_PFX_BASE64, or AEAT_MODE=off). Nothing was sent.',
    )
    await prisma.$disconnect()
    process.exit(1)
  }

  console.log(`Mode ${result.mode} · AEAT ${result.environment} · scope ${all ? 'all' : 'platform'}`)
  for (const r of result.issuers) {
    const note = r.awaitingAuthorisation ?? (r.haltedForChainOrder ? 'halted' : '')
    console.log(
      `  ${r.issuerNif.padEnd(14)} submitted ${r.submitted}  accepted ${r.accepted}  ` +
        `rejected ${r.rejected}  ${note}${r.error ? `\n    ${r.error}` : ''}`,
    )
  }
  if (result.issuers.length === 0) console.log('  (nothing due)')
  console.log(`Accepted ${result.accepted}, rejected ${result.rejected}, complete ${result.complete}`)

  await prisma.$disconnect()
}

main().catch(async (err) => {
  // Never print the env: the message from the client errors carries no secret.
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err)
  await prisma.$disconnect()
  process.exit(1)
})
