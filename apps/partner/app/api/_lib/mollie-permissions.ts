/**
 * Mollie granted-scope detection.
 *
 * Kept separate from `./mollie` on purpose: this module is imported by
 * `app/auth.ts`, which nearly every server component and action already pulls
 * in. `./mollie` imports `@mollie/api-client`, and there is no reason to drag
 * the Mollie SDK into the auth graph just to compare two lists of strings.
 *
 * Why a lookup is needed at all: adding a scope to {@link OAUTH_SCOPE_LIST}
 * only affects NEW authorizations. An already-connected partner keeps their
 * old, narrower grant — a refresh-token exchange never widens scope — so they
 * must RECONNECT before the new capability works. Until then the call fails
 * with a 403 in front of whoever happens to try it (e.g. floor staff issuing a
 * refund).
 *
 * Mollie has no token-introspection endpoint, but `GET /v2/permissions` reports
 * every permission with a `granted` boolean for the calling token and requires
 * no scope of its own — so even a minimal legacy grant can answer the question.
 * That makes the gap detectable PROACTIVELY, which is what lets the partner app
 * show a "reconnect to enable X" notification before anyone hits the failure.
 */

import prisma from '@repo/data/PrismaCient'

/**
 * Every scope our integration needs. Single source of truth for BOTH the
 * authorization URL (see `./mollie`) and the missing-permission check below, so
 * adding a scope here automatically starts flagging partners whose existing
 * grant lacks it. Do not inline a second copy of this list.
 */
export const OAUTH_SCOPE_LIST = [
  'payments.read',
  'payments.write',
  'refunds.read',
  'refunds.write',
  'profiles.read',
  'profiles.write',
  'onboarding.read',
  'onboarding.write',
]

const MOLLIE_PERMISSIONS_URL = 'https://api.mollie.com/v2/permissions'

/**
 * Bound the call: this runs inside the sign-in path, and a slow or unreachable
 * Mollie must never hold a partner out of their own dashboard.
 */
const PERMISSIONS_TIMEOUT_MS = 4000

/**
 * Which scopes the partner's current access token actually holds.
 *
 * Throws on any failure rather than returning `[]` — an empty array is
 * indistinguishable from "granted nothing", and no caller should be able to
 * turn a Mollie outage into a "you are missing every permission" alarm.
 */
export async function fetchMollieGrantedScopes(
  accessToken: string,
  timeoutMs: number = PERMISSIONS_TIMEOUT_MS,
): Promise<string[]> {
  const res = await fetch(MOLLIE_PERMISSIONS_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    throw new Error(`Mollie permissions lookup failed (${res.status})`)
  }

  const data = await res.json()
  const permissions = data?._embedded?.permissions
  if (!Array.isArray(permissions)) {
    throw new Error('Mollie permissions response had no _embedded.permissions array')
  }

  return permissions
    .filter((p: { granted?: boolean }) => p?.granted === true)
    .map((p: { id?: string }) => p?.id)
    .filter((id: unknown): id is string => typeof id === 'string')
}

/**
 * Pure: which required scopes are absent from a granted set, returned in
 * {@link OAUTH_SCOPE_LIST} order so the UI renders them deterministically.
 */
export function findMissingScopes(
  grantedScopes: string[],
  required: string[] = OAUTH_SCOPE_LIST,
): string[] {
  const granted = new Set(grantedScopes)
  return required.filter((scope) => !granted.has(scope))
}

/**
 * Resolve the missing scopes for a partner, for stamping onto their session at
 * sign-in.
 *
 * Fails OPEN — every failure path yields `[]` (no notification) rather than a
 * false "permissions missing" alarm, and a partner with no Mollie connection at
 * all yields `[]` too, since the existing "connect Mollie" banner already owns
 * that case. Nothing is lost by staying quiet: the check re-runs at the next
 * sign-in.
 *
 * @param userId - PartnerAccount.userId (the DB user id, not a provider sub)
 */
export async function resolveMissingMollieScopes(userId: string): Promise<string[]> {
  try {
    const account = await prisma.partnerAccount.findUnique({
      where: { userId },
      select: { mollieAccessToken: true },
    })
    if (!account?.mollieAccessToken) return []

    const grantedScopes = await fetchMollieGrantedScopes(account.mollieAccessToken)
    return findMissingScopes(grantedScopes)
  } catch (err: any) {
    console.error('[Mollie] Permission check failed at sign-in:', err?.message)
    return []
  }
}
