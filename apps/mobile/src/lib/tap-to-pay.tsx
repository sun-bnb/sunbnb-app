/**
 * Stripe Tap to Pay — the phone itself is the card reader ([[track:028]] P5c).
 *
 * The phone is never authoritative: the server creates the PaymentIntent
 * (collectReservationPayment `{ method: 'tap-to-pay' }`), this module only
 * runs the SDK's collect + confirm against its client secret, and the server
 * settles by polling that PaymentIntent through the reservation state machine.
 *
 * The SDK is native. Expo Go, web and a dev build compiled before the SDK was
 * added have no `StripeTerminalReactNative` native module, and the SDK reads
 * it at import time — so it is required lazily behind that check, and the
 * provider degrades to a no-op that reports `available: false`.
 *
 * Layout: the StripeTerminalProvider + bridge render as a SIBLING of the app
 * tree, not its parent, so enabling Tap to Pay once the site context arrives
 * never remounts the tabs.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import { NativeModules, Platform } from 'react-native'
import type * as StripeTerminal from '@stripe/stripe-terminal-react-native'
import { rpc, type ActionResult } from './api'

type Sdk = typeof StripeTerminal
type Reader = StripeTerminal.Reader.Type
type StripeError = StripeTerminal.StripeError

/** Simulated reader in dev unless explicitly opted into a real tap. */
const SIMULATED = __DEV__ && process.env.EXPO_PUBLIC_STRIPE_TTP_REAL !== 'true'
const SIMULATED_CARD = '4242424242424242'
const DISCOVERY_TIMEOUT_MS = 30_000

function loadSdk(): Sdk | null {
  if (Platform.OS === 'web') return null
  if (!NativeModules.StripeTerminalReactNative) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: the SDK touches its native module at import
    return require('@stripe/stripe-terminal-react-native') as Sdk
  } catch {
    return null
  }
}

const sdk = loadSdk()

export type TapOutcome = 'succeeded' | 'failed' | 'canceled'

export interface TapToPayApi {
  /** False in Expo Go / web / a build without the native SDK, or when not enabled for the site. */
  available: boolean
  /**
   * Take the tap for a server-created PaymentIntent. Resolves 'canceled' when
   * the operator/guest canceled, 'failed' on a decline; THROWS when the reader
   * could not be set up at all (connection token, discovery, connect).
   */
  collect(t: { clientSecret: string; locationId: string }): Promise<TapOutcome>
  cancel(): Promise<void>
}

const UNAVAILABLE: TapToPayApi = {
  available: false,
  collect: async () => {
    throw new Error('Tap to Pay is not available on this device.')
  },
  cancel: async () => {},
}

const TapToPayContext = createContext<TapToPayApi>(UNAVAILABLE)

export function useTapToPay(): TapToPayApi {
  return useContext(TapToPayContext)
}

type BridgeApi = Pick<TapToPayApi, 'collect' | 'cancel'>

export function TapToPayProvider({
  siteId,
  accessKey,
  enabled = true,
  children,
}: {
  siteId: string | null
  accessKey: string | null
  /** Gate from the site context (Stripe + cardPresent 'tap-to-pay'). */
  enabled?: boolean
  children: ReactNode
}) {
  const apiRef = useRef<BridgeApi | null>(null)
  const [ready, setReady] = useState(false)
  const active = !!(enabled && sdk && siteId && accessKey)

  const tokenProvider = useCallback(async () => {
    if (!siteId || !accessKey) throw new Error('Not paired')
    const res = await rpc<ActionResult & { secret?: string }>('getStripeConnectionToken', [siteId, accessKey])
    if (res.status !== 'ok' || typeof res.secret !== 'string') {
      throw new Error(res.errors?.[0] ?? 'Could not get a Stripe connection token.')
    }
    return res.secret
  }, [siteId, accessKey])

  const value = useMemo<TapToPayApi>(
    () =>
      active && ready
        ? {
            available: true,
            collect: t => {
              const api = apiRef.current
              return api ? api.collect(t) : UNAVAILABLE.collect(t)
            },
            cancel: async () => {
              await apiRef.current?.cancel()
            },
          }
        : UNAVAILABLE,
    [active, ready],
  )

  return (
    <>
      {active && sdk ? (
        <sdk.StripeTerminalProvider tokenProvider={tokenProvider} logLevel={__DEV__ ? 'verbose' : undefined}>
          <TerminalBridge key={siteId} sdk={sdk} apiRef={apiRef} onReady={setReady} />
        </sdk.StripeTerminalProvider>
      ) : null}
      <TapToPayContext.Provider value={value}>{children}</TapToPayContext.Provider>
    </>
  )
}

const isCanceled = (e: StripeError, sdkRef: Sdk) => e.code === sdkRef.ErrorCode.CANCELED

function TerminalBridge({
  sdk: s,
  apiRef,
  onReady,
}: {
  sdk: Sdk
  apiRef: MutableRefObject<BridgeApi | null>
  onReady: (ready: boolean) => void
}) {
  const readersWaiter = useRef<((readers: Reader[]) => void) | null>(null)
  const connected = useRef<{ locationId: string } | null>(null)
  const initPromise = useRef<Promise<void> | null>(null)
  const collecting = useRef(false)
  const canceled = useRef(false)
  const connectedReaderRef = useRef<Reader | null>(null)

  const {
    initialize,
    discoverReaders,
    cancelDiscovering,
    connectReader,
    disconnectReader,
    setSimulatedCard,
    retrievePaymentIntent,
    collectPaymentMethod,
    confirmPaymentIntent,
    cancelCollectPaymentMethod,
    connectedReader,
  } = s.useStripeTerminal({
    onUpdateDiscoveredReaders: readers => {
      if (readers.length > 0) readersWaiter.current?.(readers)
    },
    onDidDisconnect: () => {
      connected.current = null
    },
  })

  useEffect(() => {
    connectedReaderRef.current = (connectedReader as Reader | null | undefined) ?? null
  }, [connectedReader])

  const ensureInitialized = useCallback(() => {
    if (!initPromise.current) {
      initPromise.current = (async () => {
        if (Platform.OS === 'android') {
          const perm = await s.requestNeededAndroidPermissions({
            accessFineLocation: {
              title: 'Location',
              message: 'Location is needed to accept card payments.',
              buttonPositive: 'OK',
            },
          })
          if (perm.error) throw new Error('Location permission is required for Tap to Pay.')
        }
        const res = await initialize()
        if (res.error) throw new Error(res.error.message)
        // initialize() hands back a reader the SDK auto-reconnected — location unknown, so reconnect lazily.
      })().catch(e => {
        initPromise.current = null
        throw e
      })
    }
    return initPromise.current
  }, [s, initialize])

  const ensureConnected = useCallback(
    async (locationId: string) => {
      await ensureInitialized()
      // The SDK auto-reconnects its last reader after an app reload while our ref starts empty;
      // discovering again then fails with 'Already connected to a reader' (1110). Adopt it.
      if (!connected.current && connectedReaderRef.current) {
        connected.current = { locationId: connectedReaderRef.current.locationId ?? locationId }
      }
      if (connected.current?.locationId === locationId) return
      if (connected.current) {
        await disconnectReader()
        connected.current = null
      }

      const readers = new Promise<Reader[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          readersWaiter.current = null
          reject(new Error('No Tap to Pay reader found on this phone.'))
        }, DISCOVERY_TIMEOUT_MS)
        readersWaiter.current = r => {
          clearTimeout(timer)
          readersWaiter.current = null
          resolve(r)
        }
      })
      // Not awaited: discovery can stay open until a reader connects; readers arrive via the listener.
      const discovery = discoverReaders({ discoveryMethod: 'tapToPay', simulated: SIMULATED }).then(res => {
        if (res.error) throw new Error(res.error.message)
        return readers
      })
      const [reader] = await Promise.race([readers, discovery])
      if (!reader) throw new Error('No Tap to Pay reader found on this phone.')

      const res = await connectReader({
        discoveryMethod: 'tapToPay',
        reader,
        locationId,
        autoReconnectOnUnexpectedDisconnect: true,
      })
      void cancelDiscovering().catch(() => {})
      if (res.error) throw new Error(res.error.message)
      connected.current = { locationId }
      if (SIMULATED) await setSimulatedCard(SIMULATED_CARD)
    },
    [ensureInitialized, discoverReaders, cancelDiscovering, connectReader, disconnectReader, setSimulatedCard],
  )

  const collect = useCallback(
    async ({ clientSecret, locationId }: { clientSecret: string; locationId: string }): Promise<TapOutcome> => {
      canceled.current = false
      await ensureConnected(locationId)
      if (canceled.current) return 'canceled'

      const retrieved = await retrievePaymentIntent(clientSecret)
      if (retrieved.error) throw new Error(retrieved.error.message)
      if (canceled.current) return 'canceled'

      collecting.current = true
      const collected = await collectPaymentMethod({ paymentIntent: retrieved.paymentIntent }).finally(() => {
        collecting.current = false
      })
      if (collected.error) {
        // Log the SDK error: the modal only shows 'Declined', so this is the one place a reader-side cause is visible.
        console.warn('[TapToPay] collectPaymentMethod error', collected.error.code, collected.error.message)
        return isCanceled(collected.error, s) || canceled.current ? 'canceled' : 'failed'
      }

      const confirmed = await confirmPaymentIntent({ paymentIntent: collected.paymentIntent })
      if (confirmed.error) return isCanceled(confirmed.error, s) ? 'canceled' : 'failed'
      // succeeded or requiresCapture — either way the server's poll is the authority from here.
      return 'succeeded'
    },
    [s, ensureConnected, retrievePaymentIntent, collectPaymentMethod, confirmPaymentIntent],
  )

  const cancel = useCallback(async () => {
    canceled.current = true
    if (collecting.current) await cancelCollectPaymentMethod().catch(() => {})
  }, [cancelCollectPaymentMethod])

  useEffect(() => {
    apiRef.current = { collect, cancel }
  }, [apiRef, collect, cancel])

  useEffect(() => {
    onReady(true)
    return () => {
      onReady(false)
      apiRef.current = null
    }
  }, [apiRef, onReady])

  return null
}
