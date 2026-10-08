import { vi } from 'vitest'
import * as realConnect from '../../../../../packages/data/src/stripe/connect'

// Pure helpers keep their REAL implementation (no DB/network) so tests assert real columns.
export const snapshotFromAccount = vi.fn(realConnect.snapshotFromAccount)
export const snapshotToColumns = vi.fn(realConnect.snapshotToColumns)

export const getStripeClient = vi.fn()
export const getStripeConnectClient = vi.fn()
export const retrieveAccountSnapshot = vi.fn()
export const createConnectedAccount = vi.fn()
export const updateBusinessProfile = vi.fn()
export const attachExternalAccount = vi.fn()
export const acceptTos = vi.fn()
export const createAccountSession = vi.fn()

export const flattenMeta = vi.fn()
export const unflattenMeta = vi.fn()
export const createCheckoutSession = vi.fn()
export const fetchCheckoutState = vi.fn()
export const fetchPaymentIntentState = vi.fn()
export const refundPaymentIntent = vi.fn()
export const expireCheckoutSession = vi.fn()

export const ensureTerminalLocation = vi.fn()
export const createConnectionToken = vi.fn()
export const terminalLocationState = vi.fn()
export const createTerminalPaymentIntent = vi.fn()
export const cancelTerminalPaymentIntent = vi.fn()
