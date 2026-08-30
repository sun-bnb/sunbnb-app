/**
 * In-process Viva Cloud Terminal ISV stub (track 024, W8, packet A1).
 *
 * Lets the whole card-present rail be developed and tested without Viva
 * credentials or a real device: `createSale` opens a session that resolves to
 * `approved` after a delay (simulating the staff phone's Terminal app taking
 * the card), or immediately to `declined`/`aborted` when the caller-supplied
 * `sessionId` carries a marker — so a dev building the collect UI, or a test
 * asserting on it, can drive every branch on demand without waiting or mocking
 * `fetch`.
 *
 * **Module-level store.** Different importers within one process (a partner
 * dev-server route that creates the session, a poll endpoint that reads it)
 * must see the same session — mirrors the real API, where the session lives
 * server-side at Viva regardless of which of our routes calls in. This also
 * means state bleeds across tests in the same file unless `stubState.reset()`
 * runs in `beforeEach`.
 */

import {
  type VivaClient,
  type VivaRefundRequest,
  type VivaSaleAccepted,
  type VivaSaleRequest,
  type VivaSession,
  type VivaSessionState,
  type VivaTerminalDevice,
  assertValidIsvFee,
} from './types'

/** Time a pending sale takes to auto-resolve to `approved`, absent a marker or an explicit override. */
export const DEFAULT_RESOLVE_AFTER_MS = 4_000

/**
 * `sessionId` markers that force an immediate terminal outcome instead of the
 * timed auto-approve — substring match, case-insensitive. A dev/test mints a
 * sessionId containing one of these (e.g. `${crypto.randomUUID()}-decline`) to
 * exercise that branch on demand.
 */
const DECLINE_MARKER = 'decline'
const ABORT_MARKER = 'abort'

interface StubRecord {
  sessionId: string
  state: VivaSessionState
  amount: number
  transactionId: string
  resolveAt: number
  timer: ReturnType<typeof setTimeout> | null
}

/** Module-level so every importer in this process shares one view of session state. */
const store = new Map<string, StubRecord>()

let resolveAfterMsOverride: number | null = null

function markerState(sessionId: string): 'approved' | 'declined' | 'aborted' {
  const lower = sessionId.toLowerCase()
  if (lower.includes(DECLINE_MARKER)) return 'declined'
  if (lower.includes(ABORT_MARKER)) return 'aborted'
  return 'approved'
}

function nextTransactionId(): string {
  return `stub_tx_${Math.random().toString(36).slice(2, 10)}`
}

function toSession(record: StubRecord): VivaSession {
  return {
    sessionId: record.sessionId,
    state: record.state,
    transactionId: record.state === 'approved' ? record.transactionId : undefined,
    amount: record.state === 'approved' ? record.amount : undefined,
    raw: { stub: true, state: record.state },
  }
}

/** Construct a fresh stub `VivaClient`. All instances share the module-level store. */
export function createStubVivaClient(options?: { resolveAfterMs?: number }): VivaClient {
  const resolveAfterMs = options?.resolveAfterMs ?? resolveAfterMsOverride ?? DEFAULT_RESOLVE_AFTER_MS

  return {
    async createSale(req: VivaSaleRequest): Promise<VivaSaleAccepted> {
      assertValidIsvFee(req.amount, req.isvDetails.amount)
      if (store.has(req.sessionId)) {
        throw new Error(`Stub Viva session already exists: ${req.sessionId}`)
      }

      const forced = markerState(req.sessionId)
      const record: StubRecord = {
        sessionId: req.sessionId,
        state: forced === 'approved' ? 'pending' : forced,
        amount: req.amount,
        transactionId: nextTransactionId(),
        resolveAt: Date.now() + resolveAfterMs,
        timer: null,
      }

      if (forced === 'approved') {
        // No marker — simulate the terminal taking `resolveAfterMs` to resolve.
        record.timer = setTimeout(() => {
          const current = store.get(req.sessionId)
          if (current && current.state === 'pending') {
            current.state = 'approved'
            current.timer = null
          }
        }, resolveAfterMs)
      }

      store.set(req.sessionId, record)
      return { sessionId: req.sessionId }
    },

    async getSession(sessionId: string): Promise<VivaSession> {
      const record = store.get(sessionId)
      if (!record) {
        return { sessionId, state: 'unknown', raw: null }
      }
      return toSession(record)
    },

    async abortSession(sessionId: string, _cashRegisterId: string): Promise<VivaSession> {
      const record = store.get(sessionId)
      if (!record) {
        return { sessionId, state: 'unknown', raw: null }
      }
      if (record.state === 'pending') {
        if (record.timer) clearTimeout(record.timer)
        record.timer = null
        record.state = 'aborted'
      }
      // Already-resolved session (approved/declined/aborted): return it as-is —
      // mirrors Mollie's 422-already-paid race (see refund.ts / mollie-tokens.ts
      // precedent), abort loses to an outcome that already landed.
      return toSession(record)
    },

    async refund(req: VivaRefundRequest): Promise<VivaSaleAccepted> {
      const parent = store.get(req.parentSessionId)
      if (!parent || parent.state !== 'approved') {
        throw new Error(
          `Stub Viva refund: parent session ${req.parentSessionId} is not an approved sale`,
        )
      }
      if (store.has(req.sessionId)) {
        throw new Error(`Stub Viva session already exists: ${req.sessionId}`)
      }
      const record: StubRecord = {
        sessionId: req.sessionId,
        state: 'approved',
        amount: req.amount,
        transactionId: nextTransactionId(),
        resolveAt: Date.now(),
        timer: null,
      }
      store.set(req.sessionId, record)
      return { sessionId: req.sessionId }
    },

    async searchDevices(_merchantId: string): Promise<VivaTerminalDevice[]> {
      return [
        { terminalId: '16000010', statusId: 1, sourceCode: 'stub', virtualTerminalId: 'stub-vt-1' },
        { terminalId: '16000011', statusId: 1, sourceCode: 'stub', virtualTerminalId: 'stub-vt-2' },
      ]
    },
  }
}

/** Test/dev-loop control surface over the shared stub store. */
export const stubState = {
  /** Force a pending session straight to a terminal outcome, bypassing the timer. */
  resolveNow(sessionId: string, outcome: 'approved' | 'declined'): void {
    const record = store.get(sessionId)
    if (!record) throw new Error(`Stub Viva session not found: ${sessionId}`)
    if (record.timer) clearTimeout(record.timer)
    record.timer = null
    record.state = outcome
  },

  /** Set the default auto-resolve delay for sessions created without an explicit `resolveAfterMs` (e.g. via `getVivaClient()`). */
  setDefaultResolveAfterMs(ms: number | null): void {
    resolveAfterMsOverride = ms
  },

  /** Clear every session and any pending timers. Call in `beforeEach`/`afterEach` — the store is module-level and otherwise leaks across tests. */
  reset(): void {
    for (const record of store.values()) {
      if (record.timer) clearTimeout(record.timer)
    }
    store.clear()
    resolveAfterMsOverride = null
  },
}
