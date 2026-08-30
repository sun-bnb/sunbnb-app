/**
 * Viva.com Cloud Terminal ISV client — shared types (track 024, W8, packet A1).
 *
 * PURE, client-safe: no fetch, no env, no prisma. `VivaClient` is the interface
 * both the real HTTP client (`http-client.ts`) and the in-process dev/test stub
 * (`stub-client.ts`) implement, so packet A2 (the `collect.start` card effect)
 * codes against one contract regardless of which one `getVivaClient()` resolves.
 *
 * Modelled on the ISV scheme of Viva's Cloud Terminal API
 * (`/ecr/isv/v1/transactions:sale`, `:refund`, `/sessions/{sessionId}`,
 * `/devices:search`) — see the 2026-08-30 log entry in
 * `.claude/tracks/024-card-present-payments.md` for why Cloud Terminal (server
 * push to a paired device) is the primary design and app-to-app is a fallback
 * only (it would put `ISV_clientSecret` on the staff phone).
 */

/** Which Viva environment a config talks to. `demo` never moves real money. */
export type VivaEnv = 'demo' | 'production'

/** ISV credentials + the environment they're valid against. */
export interface VivaIsvConfig {
  clientId: string
  clientSecret: string
  /** ISV Partner's source code — applied to the sale as `isvDetails.sourceCode`. */
  sourceCode: string
  env: VivaEnv
}

/**
 * Normalised session outcome. The raw API distinguishes these via `success` +
 * `abortSuccess` on `ISVGetSessionResponse` (see `http-client.ts`
 * `normalizeSession`) — `state` collapses that into one field so callers never
 * inspect the raw shape.
 *
 * - `pending`   — session created, terminal hasn't resolved it yet (raw 202, or
 *                 200 with no `success` field).
 * - `approved`  — `success: true`.
 * - `declined`  — `success: false`, not an abort (card declined, timeout, etc).
 * - `aborted`   — `success: false` AND `abortSuccess: true` (we or the operator
 *                 aborted before the card was read).
 * - `unknown`   — session id not found (raw 404) or otherwise unresolvable.
 */
export type VivaSessionState = 'pending' | 'approved' | 'declined' | 'aborted' | 'unknown'

/** `isvDetails` on a sale request — the ISV markup + which merchant is paid. */
export interface VivaSaleIsvDetails {
  /** ISV fee in cents. Does NOT increase the total sale amount charged to the card. */
  amount: number
  /** The merchant who activated the Viva.com Terminal app/device (the venue). */
  terminalMerchantId: string
  /** ISV Partner's source code for the sale. Defaults to the client config's `sourceCode`. */
  sourceCode?: string
  /** Multi-merchant only — exclude for a single-merchant (non-multi) integration. */
  merchantId?: string
  /** Multi-merchant only — exclude for a single-merchant (non-multi) integration. */
  merchantSourceCode?: string
}

/**
 * `POST /ecr/isv/v1/transactions:sale` request body
 * (`ISVCreateSaleTransactionOptions` in the spec). All money fields are
 * INTEGER CENTS — convert with `toCents()` (`http-client.ts`) before building
 * this, never pass a float euro amount through.
 */
export interface VivaSaleRequest {
  /** A UUID WE mint — the session's identity for polling/abort. */
  sessionId: string
  /** Target terminal id (`ISVSearchDevicesResponse[].terminalId`, or the Terminal app's "Source Terminal ID"). */
  terminalId: string
  /** Cash register id — set by us, free text, identifies the till/device that opened the session. */
  cashRegisterId: string
  /** Amount to authorize, in cents. */
  amount: number
  /** ISO 4217 numeric currency code. Defaults to `'978'` (EUR). */
  currencyCode?: string
  /** Free text merchant reference — we use the reservation/collect id. */
  merchantReference: string
  /** Free text customer-facing reference. */
  customerTrns?: string
  /** Tip amount in cents. Required by the API; defaults to 0 (we don't support tipping yet). */
  tipAmount?: number
  showTransactionResult?: boolean
  showReceipt?: boolean
  isvDetails: VivaSaleIsvDetails
}

/**
 * Both `:sale` and `:refund` return 200 with an empty body ("No content
 * returned" per the spec) — the session id is the only thing worth returning;
 * the actual outcome is fetched via `getSession`.
 */
export interface VivaSaleAccepted {
  sessionId: string
}

/** Normalised session — the shape every `VivaClient` implementation returns. */
export interface VivaSession {
  sessionId: string
  state: VivaSessionState
  /** Viva's transaction id, once resolved (`ISVGetSessionResponse.transactionId`). */
  transactionId?: string
  /** Total amount authorized, in cents, once resolved. */
  amount?: number
  /** `eventId`/`transactionEventId` from the raw response, for diagnostics/logging only — never branch on it, branch on `state`. */
  eventId?: number
  /** The raw provider response (or `null` for a synthesized pending/unknown), kept for debugging and for fields not yet promoted to the normalised shape. */
  raw: unknown
}

/** A device row from `POST /ecr/isv/v1/devices:search` (`ISVSearchDevicesResponse`). */
export interface VivaTerminalDevice {
  /** Present on the ISV search response (which merchant owns the device); absent on the non-ISV variant. */
  merchantId?: string
  terminalId: string
  /** `0 WareHouse · 1 Live · 2 ReadyToShip · 3 InStock · 4 PendingKeyInjection · 5 Lost · 6 Broken · 7 Locked`. Only `1` should be sent transactions. */
  statusId: number
  sourceCode?: string
  virtualTerminalId?: string
}

/**
 * `POST /ecr/isv/v1/transactions:refund` request body
 * (`ISVCreateRefundTransactionOptions`). Note `isvDetails` here carries ONLY
 * `terminalMerchantId` — unlike the sale request, the refund does NOT repeat
 * (or need) the ISV fee amount; Viva reverses the original fee itself.
 */
export interface VivaRefundRequest {
  /** A fresh UUID we mint for the refund's own session. */
  sessionId: string
  /** The sale's sessionId being refunded. */
  parentSessionId: string
  terminalId: string
  cashRegisterId: string
  /** Amount to refund, in cents. */
  amount: number
  currencyCode?: string
  merchantReference?: string
  isvDetails: {
    terminalMerchantId: string
  }
}

/** Provider-agnostic surface both the HTTP client and the stub implement. */
export interface VivaClient {
  createSale(req: VivaSaleRequest): Promise<VivaSaleAccepted>
  getSession(sessionId: string): Promise<VivaSession>
  /** `cashRegisterId` is required by the API — only the register that opened the session may abort it. */
  abortSession(sessionId: string, cashRegisterId: string): Promise<VivaSession>
  refund(req: VivaRefundRequest): Promise<VivaSaleAccepted>
  /** `merchantId` is REQUIRED by `ISVSearchDevicesOptions` — see the http-client.ts doc comment for why the brief's `?` doesn't hold up against the spec. */
  searchDevices(merchantId: string): Promise<VivaTerminalDevice[]>
}

/**
 * Thrown by `createSale` (both the HTTP client and the stub) before any
 * network/store write when the ISV fee is non-positive or would meet/exceed
 * the sale amount. Viva declines a payment whose fee is ≥ the sale — we refuse
 * client-side first rather than spending a round trip (and a customer's card
 * tap) on a request Viva will reject.
 */
export class VivaFeeGuardError extends Error {
  constructor(
    public readonly amount: number,
    public readonly isvFeeAmount: number,
  ) {
    super(
      `Viva ISV fee guard: isvDetails.amount (${isvFeeAmount}) must be > 0 and < amount (${amount})`,
    )
    this.name = 'VivaFeeGuardError'
  }
}

/**
 * Shared guard so the HTTP client and the stub enforce the identical rule —
 * one place, one test surface. Both amounts are integer cents.
 */
export function assertValidIsvFee(amount: number, isvFeeAmount: number): void {
  if (isvFeeAmount <= 0 || isvFeeAmount >= amount) {
    throw new VivaFeeGuardError(amount, isvFeeAmount)
  }
}
