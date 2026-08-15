import { execSync } from 'child_process'

// Direct SQL against the LOCAL dev Postgres (the DB the dev servers use) for
// e2e seed/cleanup. Mirrors the verifier-sunbnb skill's docker-psql mechanics.
// e2e specs must create their own rows and delete them afterwards — never
// depend on (or litter) the developer's data.

export function psql(sql: string): string {
  return execSync(
    `docker exec -i sunbnb-postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA`,
    { input: sql, encoding: 'utf8' },
  )
}
