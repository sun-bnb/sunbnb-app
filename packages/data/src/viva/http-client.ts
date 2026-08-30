/**
 * Real Viva.com Cloud Terminal ISV HTTP client (track 024, W8, packet A1).
 *
 * Server-only: uses global `fetch` (Node 18+), no DB. Talks to two host
 * families:
 *  - `{demo-,}accounts.vivapayments.com/connect/token` — OAuth2 client-credentials
 *    (scope `urn:viva:payments:ecr:api`), for the bearer token.
 *  - `{demo-,}api.vivapayments.com/ecr/isv/v1/*` — the Cloud Terminal ISV
 *    scheme itself (sale / refund / session lookup / abort / device search).
 *
 * Token strategy mirrors `mollie-tokens.ts` in spirit (proactive, expiry-based,
 * a safety buffer before real expiry) but is simpler: client-credentials tokens
 * are anonymous to any particular partner (ONE ISV credential pair drives every
 * connected venue), so there is nothing to persist per-partner and no refresh
 * token to rotate — just an in-memory cache keyed by `env:clientId`, re-minted
 * on expiry. No DB, no advisory lock: at most a handful of concurrent requests
 * in one process race to mint a fresh token when the cache is cold, which just
 * costs a couple of redundant token calls, not incorrect behavior.
 */

import { round } from '../payment-math'
import {
  type VivaClient,
  type VivaIsvConfig,
  type VivaRefundRequest,
  type VivaSaleAccepted,
  type VivaSaleRequest,
  type VivaSession,
  type VivaSessionState,
  type VivaTerminalDevice,
  assertValidIsvFee,
} from './types'

const ECR_SCOPE = 'urn:viva:payments:ecr:api'

/** Refresh slightly before the real expiry to avoid using a token mid-flight. Mirrors mollie-tokens.ts. */
const TOKEN_EXPIRY_BUFFER_MS = 120_000

/** Typed error for any non-2xx Viva API response — carries the status + parsed/raw body for callers to branch on (e.g. 409 already-exists, 404 not-found). */
export class VivaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message?: string,
  ) {
    super(message ?? `Viva API error (${status})`)
    this.name = 'VivaApiError'
  }
}

/**
 * Convert a EUR float amount to integer cents for the Viva API boundary.
 *
 * Rounds through `round()` FIRST (2-decimal financial rounding, the same
 * function every other money computation in `@repo/data` goes through — see
 * `.claude/rules/payments.md`) and only then multiplies by 100 and rounds
 * again. In practice `Math.round(x * 100)` alone lands on the same cent value
 * for realistic amounts (double-rounding to the same precision rarely crosses
 * a boundary twice) — this is not a float-precision fix. The reason to route
 * through `round()` regardless: it is the ONE authoritative rounding decision
 * for money everywhere else in this codebase, and an unrounded value (e.g. a
 * raw division result with 10+ trailing digits from an upstream computation
 * that skipped `round()`) must land on the exact same cents a caller would get
 * from `round()`-ing it and reading the result — `toCents` must never become a
 * second, independent place a money value gets its final digit decided.
 */
export function toCents(eurAmount: number): number {
  return Math.round(round(eurAmount) * 100)
}

interface CachedToken {
  accessToken: string
  expiresAt: number
}

const tokenCache = new Map<string, CachedToken>()

/**
 * Exported for tests only — application code must never call this. The whole
 * point of `tokenCache` is that it survives across calls within a process;
 * clearing it is only correct when a test needs a clean slate between cases
 * that mock `fetch` differently.
 */
export function resetVivaTokenCacheForTests(): void {
  tokenCache.clear()
}

function tokenUrl(config: VivaIsvConfig): string {
  return config.env === 'demo'
    ? 'https://demo-accounts.vivapayments.com/connect/token'
    : 'https://accounts.vivapayments.com/connect/token'
}

/**
 * `{demo-,}api.vivapayments.com` — exported because it is also the host for
 * the ISV connected-accounts endpoints (`/isv/v1/accounts[/...]`, packet A2's
 * `accounts.ts`), not just the `/ecr/isv/v1/*` Cloud Terminal ones this file
 * talks to.
 */
export function apiBase(config: VivaIsvConfig): string {
  return config.env === 'demo' ? 'https://demo-api.vivapayments.com' : 'https://api.vivapayments.com'
}

/** Exported for reuse by other Viva HTTP clients in this directory (e.g. `accounts.ts`). */
export async function parseErrorBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '')
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function fetchAccessToken(config: VivaIsvConfig, scope: string): Promise<CachedToken> {
  const res = await fetch(tokenUrl(config), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope,
    }),
  })
  if (!res.ok) {
    throw new VivaApiError(res.status, await parseErrorBody(res), `Viva token request failed (${res.status})`)
  }
  const data = await res.json()
  const expiresInMs = (typeof data.expires_in === 'number' ? data.expires_in : 3600) * 1000
  return { accessToken: data.access_token, expiresAt: Date.now() + expiresInMs }
}

/**
 * Get a bearer token for the given OAuth2 scope, cached per `env:clientId:scope`.
 * Generalised (not hardcoded to `ECR_SCOPE`) so other Viva HTTP clients in this
 * directory — e.g. `accounts.ts`'s `urn:viva:payments:core:api:isv` scope for
 * the connected-accounts endpoints — reuse this cache instead of minting their
 * own token plumbing. Defaults to `ECR_SCOPE` so existing Cloud Terminal call
 * sites in this file are unaffected.
 */
export async function getAccessToken(config: VivaIsvConfig, scope: string = ECR_SCOPE): Promise<string> {
  const key = `${config.env}:${config.clientId}:${scope}`
  const cached = tokenCache.get(key)
  if (cached && Date.now() < cached.expiresAt - TOKEN_EXPIRY_BUFFER_MS) {
    return cached.accessToken
  }
  const fresh = await fetchAccessToken(config, scope)
  tokenCache.set(key, fresh)
  return fresh.accessToken
}

async function vivaFetch(config: VivaIsvConfig, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken(config)
  return fetch(`${apiBase(config)}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  })
}

/** Exported for reuse by other Viva HTTP clients in this directory (e.g. `accounts.ts`). */
export async function requireOk(res: Response): Promise<void> {
  if (!res.ok) {
    throw new VivaApiError(res.status, await parseErrorBody(res))
  }
}

/**
 * Map `ISVGetSessionResponse` (or a synthesized 202/404) to our normalised
 * `VivaSession`. The raw response has no single `status` field — it exposes
 * `success` (boolean, absent while still processing) and, on failure,
 * `abortSuccess` (true only when the failure IS a successful abort, as
 * opposed to a genuine decline). This is the one place that distinction is
 * made — every caller downstream branches on `state`, never on the raw shape.
 */
function normalizeSession(sessionId: string, raw: unknown): VivaSession {
  if (raw == null || typeof raw !== 'object') {
    return { sessionId, state: 'unknown', raw: raw ?? null }
  }
  const r = raw as Record<string, unknown>
  const resolvedSessionId = typeof r.sessionId === 'string' ? r.sessionId : sessionId
  const transactionId = typeof r.transactionId === 'string' ? r.transactionId : undefined
  const amount = typeof r.amount === 'number' ? r.amount : undefined
  const eventId =
    typeof r.eventId === 'number'
      ? r.eventId
      : typeof r.transactionEventId === 'number'
        ? r.transactionEventId
        : undefined

  let state: VivaSessionState
  if (typeof r.success !== 'boolean') {
    // Session exists but the terminal hasn't posted a result yet.
    state = 'pending'
  } else if (r.success === true) {
    state = 'approved'
  } else {
    state = r.abortSuccess === true ? 'aborted' : 'declined'
  }

  return { sessionId: resolvedSessionId, state, transactionId, amount, eventId, raw }
}

function buildSaleBody(req: VivaSaleRequest, config: VivaIsvConfig) {
  return {
    sessionId: req.sessionId,
    terminalId: req.terminalId,
    cashRegisterId: req.cashRegisterId,
    amount: req.amount,
    currencyCode: req.currencyCode ?? '978',
    merchantReference: req.merchantReference,
    customerTrns: req.customerTrns,
    tipAmount: req.tipAmount ?? 0,
    showTransactionResult: req.showTransactionResult ?? true,
    showReceipt: req.showReceipt ?? true,
    isvDetails: {
      amount: req.isvDetails.amount,
      terminalMerchantId: req.isvDetails.terminalMerchantId,
      sourceCode: req.isvDetails.sourceCode ?? config.sourceCode,
      merchantId: req.isvDetails.merchantId,
      merchantSourceCode: req.isvDetails.merchantSourceCode,
    },
  }
}

async function getSessionImpl(config: VivaIsvConfig, sessionId: string): Promise<VivaSession> {
  const res = await vivaFetch(config, `/ecr/isv/v1/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'GET',
  })
  if (res.status === 202) {
    return { sessionId, state: 'pending', raw: null }
  }
  if (res.status === 404) {
    return { sessionId, state: 'unknown', raw: null }
  }
  await requireOk(res)
  const body = await res.json()
  return normalizeSession(sessionId, body)
}

/** Construct the real Viva Cloud Terminal ISV client. Talks to the network — see `getVivaClient()` in `index.ts` for how mode is chosen. */
export function createVivaHttpClient(config: VivaIsvConfig): VivaClient {
  return {
    async createSale(req: VivaSaleRequest): Promise<VivaSaleAccepted> {
      assertValidIsvFee(req.amount, req.isvDetails.amount)
      const res = await vivaFetch(config, '/ecr/isv/v1/transactions:sale', {
        method: 'POST',
        body: JSON.stringify(buildSaleBody(req, config)),
      })
      await requireOk(res) // 200 body is "No content returned" — nothing useful to parse.
      return { sessionId: req.sessionId }
    },

    async getSession(sessionId: string): Promise<VivaSession> {
      return getSessionImpl(config, sessionId)
    },

    async abortSession(sessionId: string, cashRegisterId: string): Promise<VivaSession> {
      const res = await fetch(
        `${apiBase(config)}/ecr/isv/v1/sessions/${encodeURIComponent(sessionId)}?cashRegisterId=${encodeURIComponent(cashRegisterId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${await getAccessToken(config)}` },
        },
      )
      // 200 (accepted) and 409 (abort already in progress) both mean "go look
      // at the session" — the abort itself is async, and if the card was
      // already read the session may have resolved to approved in the
      // meantime (the Mollie 422-already-paid race this mirrors).
      if (res.status === 200 || res.status === 409) {
        return getSessionImpl(config, sessionId)
      }
      if (res.status === 404) {
        return { sessionId, state: 'unknown', raw: null }
      }
      throw new VivaApiError(res.status, await parseErrorBody(res))
    },

    async refund(req: VivaRefundRequest): Promise<VivaSaleAccepted> {
      const res = await vivaFetch(config, '/ecr/isv/v1/transactions:refund', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: req.sessionId,
          terminalId: req.terminalId,
          cashRegisterId: req.cashRegisterId,
          parentSessionId: req.parentSessionId,
          amount: req.amount,
          currencyCode: req.currencyCode ?? '978',
          merchantReference: req.merchantReference,
          isvDetails: { terminalMerchantId: req.isvDetails.terminalMerchantId },
        }),
      })
      await requireOk(res)
      return { sessionId: req.sessionId }
    },

    async searchDevices(merchantId: string): Promise<VivaTerminalDevice[]> {
      const res = await vivaFetch(config, '/ecr/isv/v1/devices:search', {
        method: 'POST',
        body: JSON.stringify({ merchantId }),
      })
      await requireOk(res)
      const body = (await res.json()) as unknown[]
      return body.map((raw) => {
        const r = raw as Record<string, unknown>
        return {
          merchantId: typeof r.merchantId === 'string' ? r.merchantId : undefined,
          terminalId: String(r.terminalId),
          statusId: typeof r.statusId === 'number' ? r.statusId : Number(r.statusId),
          sourceCode: typeof r.sourceCode === 'string' ? r.sourceCode : undefined,
          virtualTerminalId: typeof r.virtualTerminalId === 'string' ? r.virtualTerminalId : undefined,
        }
      })
    },
  }
}
