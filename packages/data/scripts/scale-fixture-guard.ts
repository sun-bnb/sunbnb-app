/**
 * Target guard for the destructive scale-benchmark fixture (track 020 P0).
 *
 * `seed-scale-fixture.ts` TRUNCATEs before it seeds. That is fine against a
 * throwaway benchmark database and catastrophic anywhere else, so the decision
 * "may I write here?" is isolated in this pure module: no Prisma import, no
 * side effects, no process.exit — just a function that throws. That makes the
 * guard unit-testable, which matters more here than anywhere else in the
 * package, because the failure mode is silent data loss rather than a red test.
 *
 * Three independent conditions, each sufficient to refuse:
 *   1. host must be local            — blocks the Neon test/production URLs
 *   2. database must be allowlisted  — blocks `postgres` (local dev) and
 *                                      `sunbnb_test` (owned by the integration
 *                                      suites, TRUNCATEd between files)
 *   3. non-default database needs --force
 *
 * Note (2) is checked AFTER (3) but is not overridable by it: `--force` only
 * relaxes "is this the default database", never "is this database allowed".
 */

export interface GuardOptions {
  /** Databases this script may ever touch, even with `--force`. */
  allowedDatabases?: string[]
  /** The database used when none is named — the only one that needs no `--force`. */
  defaultDatabase?: string
  /** Whether `--force` was passed. */
  force?: boolean
}

export const DEFAULT_ALLOWED_DATABASES = ['sunbnb_scale']
export const DEFAULT_DATABASE = 'sunbnb_scale'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', ''])

/**
 * Validate a connection string as a safe destructive-write target.
 *
 * @throws if the target is missing, unparseable, remote, or not allowlisted.
 * @returns the parsed URL and the extracted database name.
 */
export function assertSafeTarget(
  rawUrl: string | undefined,
  options: GuardOptions = {}
): { url: URL; database: string } {
  const {
    allowedDatabases = DEFAULT_ALLOWED_DATABASES,
    defaultDatabase = DEFAULT_DATABASE,
    force = false,
  } = options

  if (!rawUrl) {
    throw new Error('POSTGRES_URL is not set — refusing to run.')
  }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('POSTGRES_URL is not a valid URL — refusing to run.')
  }

  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    throw new Error(
      `POSTGRES_URL has protocol "${url.protocol}" — expected postgres:. Refusing to run.`
    )
  }

  // `URL.hostname` strips IPv6 brackets, so `::1` arrives bare.
  const host = url.hostname
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to run against a non-local host (${host}). ` +
        'This script TRUNCATEs data; it is for local benchmarking only.'
    )
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))

  if (!database) {
    throw new Error('POSTGRES_URL names no database — refusing to run.')
  }

  if (database !== defaultDatabase && !force) {
    throw new Error(
      `Refusing to run against database "${database}" without --force. ` +
        `Expected "${defaultDatabase}".`
    )
  }

  if (!allowedDatabases.includes(database)) {
    throw new Error(
      `Database "${database}" is not on the allowlist [${allowedDatabases.join(', ')}]. ` +
        'Refusing to run — even with --force. `sunbnb_test` is owned by the ' +
        'integration suites and must never hold a scale fixture.'
    )
  }

  return { url, database }
}

/** Connection string with credentials stripped, for logging. */
export function maskDbUrl(url: URL): string {
  return `${url.protocol}//${url.host}${url.pathname}`
}
