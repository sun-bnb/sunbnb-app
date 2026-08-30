/**
 * Viva.com ISV connected-accounts client (track 024, W8, packet A2).
 *
 * Onboards a venue's own Viva merchant account under our ISV partnership —
 * roadmap P1 ("Viva merchant connect"), the schema counterpart to this file
 * being `PartnerAccount.viva*` + `VivaTerminal` (see the migration in this
 * same packet). `POST /isv/v1/accounts` (Create a connected account) mints an
 * `accountId` and an onboarding `invitation.redirectUrl` the partner follows
 * to complete KYB; `GET /isv/v1/accounts/{accountId}` (Retrieve) polls status
 * and yields the `merchantId` the Cloud Terminal ISV sale endpoints need as
 * `isvDetails.terminalMerchantId` (`http-client.ts` `VivaSaleIsvDetails`).
 *
 * Server-only: uses global `fetch` (Node 18+), no DB. Auth reuses
 * `http-client.ts`'s token cache (`getAccessToken`), generalised by scope
 * rather than duplicated — connected accounts use a DIFFERENT OAuth2 scope
 * (`urn:viva:payments:core:api:isv`) than the Cloud Terminal sale endpoints
 * (`urn:viva:payments:ecr:api`), but the same client-credentials grant, the
 * same token host, and the same `env:clientId` cache key shape.
 *
 * SPEC CONTRADICTS THE TASK BRIEF in three places — verified against the
 * downloaded OpenAPI (`isv.yaml`, `connected_account_request` /
 * `connected_account_response` / `retrieve_account_response` definitions),
 * not just prose — always check the actual schema:
 *
 * 1. **Path is `/isv/v1/accounts[/{accountId}]`, NOT `/platforms/v1/accounts`**
 *    as the brief said. The spec's `servers:` block for both operations is
 *    `{demo-,}api.vivapayments.com` — same host `http-client.ts` already
 *    talks to, hence `apiBase()` is reused unchanged.
 * 2. **The create request body accepts ONLY `email`, `returnUrl`, and
 *    `branding { partnerName, logoUrl, primaryColor? }`** — `connected_account_request`
 *    in the spec has no `legalName`, `tradeName`, `taxNumber`, `mobile`, or
 *    `address` fields at all. Those fields are kept on
 *    `VivaCreateConnectedAccountInput` (a caller's onboarding form already
 *    collects them and would otherwise need a Viva-specific carve-out) but
 *    are deliberately NOT forwarded on the wire — sending fields a strict
 *    schema doesn't declare risks the request being rejected rather than the
 *    fields being silently ignored, so this client never lets them leak in.
 * 3. **The retrieve response exposes a BOOLEAN `verified` field, not a status
 *    STRING vocabulary.** There is no API-exposed value distinguishing
 *    "rejected" from "still pending" — the *webhook* is literally named
 *    "Account Verification Status Changed" (`eventTypeId` 8194), which
 *    implies a richer vocabulary exists somewhere in Viva's model, but this
 *    spec's retrieve response does not expose it. Normalisation here is
 *    therefore `verified: true` -> `'verified'`, `verified: false` ->
 *    `'pending'`, missing/malformed body -> `'unknown'`. `'rejected'` is kept
 *    in the `VivaAccountVerificationStatus` union for forward-compatibility
 *    with a future webhook-sourced status (P1's `Account Verification Status
 *    Changed` webhook, not yet built) — nothing in THIS client can currently
 *    produce it; do not treat it as reachable from `getConnectedAccount` today.
 */

import { apiBase, getAccessToken, requireOk, VivaApiError } from './http-client'
import type { VivaIsvConfig } from './types'

/** OAuth2 scope for the ISV connected-accounts endpoints — distinct from `ECR_SCOPE` in `http-client.ts`. */
const ACCOUNTS_SCOPE = 'urn:viva:payments:core:api:isv'

export interface VivaAccountBranding {
  partnerName: string
  logoUrl: string
  primaryColor?: string
}

export interface VivaCreateConnectedAccountInput {
  email: string
  returnUrl: string
  branding: VivaAccountBranding
  /**
   * NOT sent to Viva. The `connected_account_request` schema
   * (`isv.yaml`) has no fields for legal/trade name, tax number, mobile, or
   * address as of 2026-08-30 — see the module doc comment (contradiction #2).
   * Kept on this type only so a caller with an onboarding form that already
   * collects this data doesn't need a Viva-specific subset; this client
   * silently drops them rather than sending fields the schema doesn't declare.
   */
  legalName?: string
  tradeName?: string
  taxNumber?: string
  mobile?: string
  address?: string
}

export interface VivaAccountInvitation {
  email: string
  redirectUrl: string
  created: string
}

export interface VivaConnectedAccountCreated {
  accountId: string
  invitation: VivaAccountInvitation
}

/**
 * Normalised verification status. Only `'pending'`, `'verified'`, and
 * `'unknown'` are reachable from `getConnectedAccount` today (see
 * contradiction #3 above) — `'rejected'` is reserved for a future
 * webhook-sourced signal.
 */
export type VivaAccountVerificationStatus = 'pending' | 'verified' | 'rejected' | 'unknown'

export interface VivaConnectedAccount {
  accountId: string
  email?: string
  verificationStatus: VivaAccountVerificationStatus
  /** The venue's Viva merchant id — becomes `isvDetails.terminalMerchantId` on a sale once present. */
  merchantId?: string
  /** `true` once the account can charge cards and accept payments (`retrieve_account_response.acquiringEnabled`). */
  acquiringEnabled?: boolean
  /** The raw provider response, for fields not yet promoted to the normalised shape (the example response includes `taxNumber`/`vatNumber`/`legalName`/`registrationNumber` the schema doesn't formally declare). */
  raw: unknown
}

/** Provider-agnostic surface both the HTTP client and the stub implement. */
export interface VivaAccountsClient {
  createConnectedAccount(input: VivaCreateConnectedAccountInput): Promise<VivaConnectedAccountCreated>
  getConnectedAccount(accountId: string): Promise<VivaConnectedAccount>
}

function normalizeVerificationStatus(raw: Record<string, unknown>): VivaAccountVerificationStatus {
  if (typeof raw.verified === 'boolean') return raw.verified ? 'verified' : 'pending'
  return 'unknown'
}

function normalizeConnectedAccount(fallbackAccountId: string, raw: unknown): VivaConnectedAccount {
  if (raw === null || typeof raw !== 'object') {
    return { accountId: fallbackAccountId, verificationStatus: 'unknown', raw: raw ?? null }
  }
  const r = raw as Record<string, unknown>
  return {
    accountId: typeof r.accountId === 'string' ? r.accountId : fallbackAccountId,
    email: typeof r.email === 'string' ? r.email : undefined,
    verificationStatus: normalizeVerificationStatus(r),
    merchantId: typeof r.merchantId === 'string' ? r.merchantId : undefined,
    acquiringEnabled: typeof r.acquiringEnabled === 'boolean' ? r.acquiringEnabled : undefined,
    raw,
  }
}

function normalizeInvitation(raw: unknown, fallbackEmail: string): VivaAccountInvitation {
  const r = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    email: typeof r.email === 'string' ? r.email : fallbackEmail,
    redirectUrl: typeof r.redirectUrl === 'string' ? r.redirectUrl : '',
    created: typeof r.created === 'string' ? r.created : '',
  }
}

async function vivaAccountsFetch(config: VivaIsvConfig, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken(config, ACCOUNTS_SCOPE)
  return fetch(`${apiBase(config)}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  })
}

/** Construct the real Viva ISV connected-accounts HTTP client. Talks to the network — see `getVivaAccountsClient()` in `index.ts` for how mode is chosen. */
export function createVivaAccountsHttpClient(config: VivaIsvConfig): VivaAccountsClient {
  return {
    async createConnectedAccount(input: VivaCreateConnectedAccountInput): Promise<VivaConnectedAccountCreated> {
      const res = await vivaAccountsFetch(config, '/isv/v1/accounts', {
        method: 'POST',
        body: JSON.stringify({
          email: input.email,
          returnUrl: input.returnUrl,
          branding: {
            partnerName: input.branding.partnerName,
            logoUrl: input.branding.logoUrl,
            primaryColor: input.branding.primaryColor,
          },
        }),
      })
      await requireOk(res)
      const body = (await res.json()) as Record<string, unknown>
      const accountId = typeof body.accountId === 'string' ? body.accountId : ''
      if (!accountId) {
        throw new VivaApiError(res.status, body, 'Viva create-connected-account response had no accountId')
      }
      return { accountId, invitation: normalizeInvitation(body.invitation, input.email) }
    },

    async getConnectedAccount(accountId: string): Promise<VivaConnectedAccount> {
      const res = await vivaAccountsFetch(config, `/isv/v1/accounts/${encodeURIComponent(accountId)}`, {
        method: 'GET',
      })
      if (res.status === 404) {
        return { accountId, verificationStatus: 'unknown', raw: null }
      }
      await requireOk(res)
      const body = await res.json()
      return normalizeConnectedAccount(accountId, body)
    },
  }
}

// ---------------------------------------------------------------------------
// Stub — module-level store, dev/test default (no Viva credentials required).
// Mirrors `stub-client.ts`'s discipline: the store is MODULE-LEVEL so a
// separately-constructed client elsewhere in the same process (another route,
// another test in the same file) sees what an earlier call wrote — matching
// the real API, where the account lives at Viva regardless of which local
// call created it.
// ---------------------------------------------------------------------------

interface StubAccountRecord {
  accountId: string
  email: string
  verified: boolean
  merchantId?: string
  invitation: VivaAccountInvitation
}

const stubAccounts = new Map<string, StubAccountRecord>()
let stubAccountSeq = 0

function mintStubAccountId(): string {
  stubAccountSeq += 1
  return `stub_acct_${stubAccountSeq}_${Date.now().toString(36)}`
}

function mintStubMerchantId(accountId: string): string {
  return `stub_merchant_${accountId}`
}

/** Test/dev-loop control surface for the stub — mirrors `stubState` in `stub-client.ts`. */
export const accountsStubState = {
  /**
   * Simulate Viva completing KYB for a connected account. `merchantId`
   * defaults to a minted value if omitted (the real Retrieve response only
   * carries a `merchantId` once the account is connected/verified).
   */
  verify(accountId: string, merchantId?: string): VivaConnectedAccount {
    const record = stubAccounts.get(accountId)
    if (!record) {
      throw new Error(`accountsStubState.verify: unknown stub accountId "${accountId}" — call createConnectedAccount first`)
    }
    record.verified = true
    record.merchantId = merchantId ?? record.merchantId ?? mintStubMerchantId(accountId)
    return normalizeConnectedAccount(accountId, {
      accountId: record.accountId,
      email: record.email,
      verified: record.verified,
      merchantId: record.merchantId,
      acquiringEnabled: true,
    })
  },
  /** Clear all stub accounts. Call in `beforeEach`/`afterEach` — module-level state leaks across tests otherwise. */
  reset(): void {
    stubAccounts.clear()
    stubAccountSeq = 0
  },
}

/** Construct the in-process dev/test Viva ISV connected-accounts client. No network, no env. */
export function createStubVivaAccountsClient(): VivaAccountsClient {
  return {
    async createConnectedAccount(input: VivaCreateConnectedAccountInput): Promise<VivaConnectedAccountCreated> {
      const accountId = mintStubAccountId()
      const invitation: VivaAccountInvitation = {
        email: input.email,
        redirectUrl: `https://stub.viva.local/onboarding/${accountId}`,
        created: new Date().toISOString(),
      }
      stubAccounts.set(accountId, { accountId, email: input.email, verified: false, invitation })
      return { accountId, invitation }
    },

    async getConnectedAccount(accountId: string): Promise<VivaConnectedAccount> {
      let record = stubAccounts.get(accountId)
      // Dev-loop convenience: with no way to "complete KYB" from a running app
      // (and the module-level store lost on every dev-server restart), the stub
      // verifies any stub account on its first Retrieve unless
      // VIVA_STUB_AUTO_VERIFY=false (tests set it off to exercise `pending`).
      if (process.env.VIVA_STUB_AUTO_VERIFY !== 'false' && accountId.startsWith('stub_acct_')) {
        if (!record) {
          record = { accountId, email: '', verified: false, invitation: { email: '', redirectUrl: '', created: new Date().toISOString() } }
          stubAccounts.set(accountId, record)
        }
        if (!record.verified) accountsStubState.verify(accountId)
      }
      if (!record) {
        return { accountId, verificationStatus: 'unknown', raw: null }
      }
      return normalizeConnectedAccount(accountId, {
        accountId: record.accountId,
        email: record.email,
        verified: record.verified,
        merchantId: record.merchantId,
        acquiringEnabled: record.verified ? true : undefined,
      })
    },
  }
}
