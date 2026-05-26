/**
 * Pre-warm + verify partner Mollie tokens.
 *
 * For every PartnerAccount with a Mollie connection, ask the centralized token
 * manager (getValidMollieToken) for a valid access token. This:
 *   (a) refreshes + backfills the previously-NULL `mollie_token_expires_at` for
 *       partners who connected before that column existed — ending the
 *       "refresh on every call" churn (the fast path can finally engage), and
 *   (b) verifies the stored refresh token is still alive, surfacing exactly which
 *       partners must reconnect instead of a customer hitting "session expired"
 *       at checkout.
 *
 * The target DB is whatever POSTGRES_URL points at — use scripts/with-db-url.sh
 * to select test/prod (the npm scripts below do). Refreshing also needs
 * MOLLIE_CLIENT_ID + MOLLIE_CLIENT_SECRET in the environment (loaded from
 * packages/data/.env.local if present).
 *
 * Usage (from packages/data):
 *   npm run prewarm:mollie:test                  # dry-run (read-only) against TEST DB
 *   npm run prewarm:mollie:test -- --commit      # refresh + verify against TEST DB
 *   npm run prewarm:mollie:production -- --commit
 *
 * Dry-run lists each connected partner and its token/expiry state without any
 * Mollie call or token rotation. --commit actually refreshes (and rotates) only
 * the tokens that aren't already fresh.
 */
import { config as loadDotenv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// POSTGRES_URL is set inline by with-db-url.sh; load the rest (MOLLIE_CLIENT_ID/
// SECRET, etc.) from packages/data/.env.local WITHOUT overriding what's set.
const here = dirname(fileURLToPath(import.meta.url))
loadDotenv({ path: join(here, '..', '.env.local'), override: false })

const COMMIT = process.argv.includes('--commit')

function dbTarget(): string {
  try {
    const u = new URL(process.env.POSTGRES_URL ?? '')
    return `${u.host}${u.pathname}`
  } catch {
    return '(POSTGRES_URL not set)'
  }
}

async function main() {
  console.log(
    `\nMollie token pre-warm — DB ${dbTarget()} — mode: ${COMMIT ? 'COMMIT (refresh + verify)' : 'dry-run (read-only)'}\n`,
  )

  if (COMMIT && (!process.env.MOLLIE_CLIENT_ID || !process.env.MOLLIE_CLIENT_SECRET)) {
    console.error(
      'MOLLIE_CLIENT_ID and MOLLIE_CLIENT_SECRET must be set to refresh tokens.\n' +
        'Add them to packages/data/.env.local (same values as the apps) or export them, then re-run.',
    )
    process.exit(1)
  }

  // Import after env is in place — index.ts reads POSTGRES_URL at module init.
  const prisma = (await import('../index')).default
  const { getValidMollieToken, MollieReconnectRequiredError } = await import('../src/mollie-tokens')

  const accounts = await prisma.partnerAccount.findMany({
    where: { mollieAccessToken: { not: null } },
    select: {
      userId: true,
      company: true,
      mollieProfileId: true,
      mollieRefreshToken: true,
      mollieTokenExpiresAt: true,
    },
    orderBy: { company: 'asc' },
  })

  console.log(`${accounts.length} partner account(s) with a Mollie connection\n`)

  const healthy: string[] = []
  const reconnect: string[] = []
  const errored: string[] = []

  for (const a of accounts) {
    const label = `${a.company ?? '(no company)'} [${a.userId}] profile=${a.mollieProfileId ?? '—'}`

    if (!COMMIT) {
      const expiry = a.mollieTokenExpiresAt ? a.mollieTokenExpiresAt.toISOString() : 'NULL'
      const refresh = a.mollieRefreshToken ? 'refresh-token✓' : 'refresh-token✗'
      console.log(`· ${label}\n    expiry=${expiry}  ${refresh}`)
      continue
    }

    try {
      await getValidMollieToken(a.userId)
      const after = await prisma.partnerAccount.findUnique({
        where: { userId: a.userId },
        select: { mollieTokenExpiresAt: true },
      })
      healthy.push(label)
      console.log(
        `✓ ${label}\n    healthy — expiry now ${after?.mollieTokenExpiresAt?.toISOString() ?? 'NULL'}`,
      )
    } catch (err) {
      if (err instanceof MollieReconnectRequiredError) {
        reconnect.push(label)
        console.log(`✗ ${label}\n    NEEDS RECONNECT — ${err.message}`)
      } else {
        errored.push(label)
        console.log(`! ${label}\n    error (likely transient, safe to re-run) — ${(err as Error).message}`)
      }
    }
  }

  if (COMMIT) {
    console.log(
      `\nSummary: ${healthy.length} healthy · ${reconnect.length} need reconnect · ${errored.length} errored`,
    )
    if (reconnect.length) {
      console.log('\nPartners that must reconnect Mollie (reach out to these):')
      reconnect.forEach((l) => console.log(`  - ${l}`))
    }
    if (errored.length) {
      console.log('\nTransient errors (re-run to retry):')
      errored.forEach((l) => console.log(`  - ${l}`))
    }
  } else {
    console.log('\nDry-run only — nothing refreshed. Re-run with `-- --commit` to refresh + verify.')
  }

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error('Pre-warm failed:', err)
  process.exit(1)
})
