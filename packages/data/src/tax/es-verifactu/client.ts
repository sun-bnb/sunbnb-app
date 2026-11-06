/**
 * The AEAT submission client — stub and real (track 026 phase 7.1b).
 *
 * `getAeatClient()` is the ONE place that decides whether anything is sent,
 * mirroring `packages/data/src/viva/index.ts`, so the sweep never branches on env
 * itself.
 *
 * Transmission resolution (`resolveAeatMode`):
 *  - `AEAT_MODE=off` (or the legacy `stub`) → off, always: the sweep is paused.
 *  - `AEAT_MODE=http` → real client, always; **throws if the certificate is
 *    missing** rather than quietly degrading.
 *  - unset, `AEAT_CERT_PFX_BASE64` present → real client.
 *  - unset, no certificate → off.
 *
 * ## Off means PAUSED, never "send to a stub"
 *
 * The one thing worse than not submitting is believing we submitted. Until
 * 2026-11 an unconfigured environment fell back to the stub client, and the
 * sweep marked every record `sent` from the stub's fake acceptances — so a
 * production deployment with no certificate would have read the register as
 * complete while AEAT held nothing. Now `getAeatClient()` returns `null` when
 * transmission is off and the sweep leaves every record `pending`. The stub
 * exists only for tests, which construct it explicitly with
 * `createStubAeatClient()` and inject it.
 *
 * ## The AEAT environment must match the deployment
 *
 * `AEAT_ENV=production` files real records, so it is accepted ONLY on a Vercel
 * production deployment (`VERCEL_ENV=production`), and a production deployment
 * REQUIRES it. A laptop, CI or a preview can therefore never file to production,
 * and production can never file to preproducción because a variable was
 * forgotten — either mismatch throws `AeatEnvironmentMismatchError` before a
 * client exists. See `aeatEnvironmentMismatch`.
 *
 * ## Certificate handling
 *
 * `AEAT_CERT_PFX_BASE64` + `AEAT_CERT_PASSWORD` as Vercel SENSITIVE env vars
 * (write-only), on the admin project's Production environment only,
 * decoded into an https.Agent per cold start and never written to disk. One
 * certificate for the whole platform (D2: colaboración social under Convenio 17),
 * which is what makes a single env pair sufficient — we never hold a partner's
 * own certificate.
 */

import https from 'node:https'
import { ENDPOINTS } from './registro-xml'
import { parseSubmissionReply, wrapSoap, type SubmissionReply } from './soap'

/** What a client instance is. `stub` exists only when a test constructs one. */
export type AeatMode = 'stub' | 'http'
/** What the environment asks for. `off` pauses the sweep; nothing is marked sent. */
export type AeatTransmission = 'off' | 'http'
export type AeatEnvironment = 'production' | 'pruebas'

export interface AeatClient
  extends Readonly<{
    mode: AeatMode
    environment: AeatEnvironment
    endpoint: string
  }> {
  /** Send one `RegFactuSistemaFacturacion` document. */
  submit(payloadXml: string): Promise<SubmissionReply>
}

export class AeatTransportError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly body?: string,
  ) {
    super(message)
    this.name = 'AeatTransportError'
  }
}

export class AeatCertificateMissingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AeatCertificateMissingError'
  }
}

export class AeatEnvironmentMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AeatEnvironmentMismatchError'
  }
}

function resolveEnvironment(env: NodeJS.ProcessEnv): AeatEnvironment {
  // Default to pruebas. A wrong guess toward the sandbox costs a re-run; a wrong
  // guess toward production files real records from a dev machine.
  return env.AEAT_ENV === 'production' ? 'production' : 'pruebas'
}

function resolveMode(env: NodeJS.ProcessEnv): AeatTransmission {
  const explicit = env.AEAT_MODE
  if (explicit === 'http') return 'http'
  // `stub` is the pre-2026-11 spelling of the pause switch; it is read as `off`
  // so an environment still carrying it pauses rather than reverting to the
  // fake-acceptance behaviour it used to select.
  if (explicit === 'off' || explicit === 'stub') return 'off'
  return env.AEAT_CERT_PFX_BASE64 ? 'http' : 'off'
}

/**
 * Why this deployment may not talk to the configured AEAT environment, or `null`
 * when it may.
 *
 * Keyed on `VERCEL_ENV`, which Vercel sets on every deployment and nothing sets on
 * a laptop. Both directions are refused:
 *  - production deployment, AEAT pruebas — real invoices would be marked `sent`
 *    against preproducción, which keeps nothing. Usually a forgotten `AEAT_ENV`.
 *  - anything else, AEAT production — a laptop, CI or a branch preview filing
 *    real records, typically against the TEST database's fake invoices.
 *
 * Exported so the admin page can show the mismatch before a sweep trips on it.
 */
export function aeatEnvironmentMismatch(env: NodeJS.ProcessEnv): string | null {
  const productionDeployment = env.VERCEL_ENV === 'production'
  const environment = resolveEnvironment(env)
  if (productionDeployment && environment !== 'production') {
    return (
      'This is a production deployment but AEAT_ENV is not "production". Refusing to ' +
      'file real invoices to preproducción, where they would read as sent and be lost.'
    )
  }
  if (!productionDeployment && environment === 'production') {
    return (
      'AEAT_ENV=production is only accepted on a Vercel production deployment ' +
      '(VERCEL_ENV=production). Refusing to file to AEAT production from here.'
    )
  }
  return null
}

// ─── the real client ─────────────────────────────────────────────────────────

export function createAeatHttpClient(env: NodeJS.ProcessEnv = process.env): AeatClient {
  const pfxBase64 = env.AEAT_CERT_PFX_BASE64
  if (!pfxBase64) {
    throw new AeatCertificateMissingError(
      'AEAT_MODE=http but AEAT_CERT_PFX_BASE64 is not set. Refusing to fall back to the ' +
        'stub: marking records as sent against a stub would make the register read complete ' +
        'while AEAT holds nothing.',
    )
  }

  const mismatch = aeatEnvironmentMismatch(env)
  if (mismatch) throw new AeatEnvironmentMismatchError(mismatch)

  const environment = resolveEnvironment(env)
  // The non-Sello hosts: www10/prewww10 are the ...Sello ports and expect a
  // certificado de sello electrónico, while we hold an FNMT Certificado de
  // Representante. Pointing at the wrong one fails during the TLS handshake,
  // which reads as a network fault rather than a configuration error.
  const endpoint = environment === 'production' ? ENDPOINTS.production : ENDPOINTS.pruebas

  const agent = new https.Agent({
    pfx: Buffer.from(pfxBase64, 'base64'),
    passphrase: env.AEAT_CERT_PASSWORD,
    keepAlive: true,
  })

  return {
    mode: 'http',
    environment,
    endpoint,
    async submit(payloadXml: string): Promise<SubmissionReply> {
      const body = wrapSoap(payloadXml)
      let response: Response
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/xml; charset=UTF-8',
            // Empty on purpose — the WSDL declares soapAction="". The HEADER
            // must still be present; some stacks reject a SOAP 1.1 request
            // without it.
            SOAPAction: '""',
          },
          body,
          // @ts-expect-error — Node's fetch accepts an agent via this key; it is
          // not in the DOM lib types.
          agent,
        })
      } catch (cause) {
        throw new AeatTransportError(
          `AEAT request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
      }

      const text = await response.text()
      if (!response.ok) {
        // A 500 can still carry a SOAP Fault, which is more informative than the
        // status, so the body is attached rather than discarded.
        throw new AeatTransportError(
          `AEAT returned HTTP ${response.status}`,
          response.status,
          text.slice(0, 2000),
        )
      }
      return parseSubmissionReply(text)
    },
  }
}

// ─── the stub ────────────────────────────────────────────────────────────────
//
// Test-only. Nothing in the env resolution returns it: a stub that accepts
// everything, wired into a real sweep, marks real records `sent`.

export interface StubBehaviour {
  /**
   * Decide the reply for one record, by its `NumSerieFactura`. Default: accepted.
   * Lets a test produce `AceptadoConErrores`, a duplicate or a rejection without
   * a sandbox.
   */
  replyFor?: (numSerieFactura: string) => {
    estado: 'Correcto' | 'AceptadoConErrores' | 'Incorrecto'
    codigoError?: number
    descripcionError?: string
    duplicado?: boolean
  }
  /** Throw instead of replying, to exercise the transport-failure path. */
  failWith?: Error
  /** Seconds to report in `TiempoEsperaEnvio`. */
  tiempoEsperaEnvioSeconds?: number
}

export interface StubAeatClient extends AeatClient {
  /** Every document the sweep handed over, in order. */
  readonly submissions: string[]
}

export function createStubAeatClient(behaviour: StubBehaviour = {}): StubAeatClient {
  const submissions: string[] = []

  return {
    mode: 'stub',
    environment: 'pruebas',
    endpoint: 'stub://aeat',
    submissions,
    async submit(payloadXml: string): Promise<SubmissionReply> {
      submissions.push(payloadXml)
      if (behaviour.failWith) throw behaviour.failWith

      // Read back the numbers actually in the document, so a test cannot pass by
      // agreeing with itself about what was sent.
      const numbers = Array.from(
        payloadXml.matchAll(/<sf:NumSerieFactura>([^<]*)<\/sf:NumSerieFactura>/g),
      ).map((m) => m[1]!)
      // The chaining block repeats the PREVIOUS invoice's number, so the same
      // number can appear twice; only the first occurrence per record is the
      // record's own. De-duplicating by first appearance keeps the reply aligned.
      const unique = Array.from(new Set(numbers))

      const lines = unique.map((num) => {
        const r = behaviour.replyFor?.(num) ?? { estado: 'Correcto' as const }
        return {
          numSerieFactura: num,
          issuerNif: 'STUB',
          fechaExpedicion: '01-01-2026',
          estado: r.estado,
          codigoError: r.codigoError ?? null,
          descripcionError: r.descripcionError ?? null,
          duplicado: r.duplicado ?? false,
        }
      })

      const anyBad = lines.some((l) => l.estado === 'Incorrecto')
      const allBad = lines.length > 0 && lines.every((l) => l.estado === 'Incorrecto')

      return {
        estadoEnvio: allBad ? 'Incorrecto' : anyBad ? 'ParcialmenteCorrecto' : 'Correcto',
        csv: allBad ? null : `STUB-CSV-${submissions.length}`,
        tiempoEsperaEnvioSeconds: behaviour.tiempoEsperaEnvioSeconds ?? 60,
        lines,
      }
    },
  }
}

// ─── the switch ──────────────────────────────────────────────────────────────

/**
 * The env-resolved client, or `null` when transmission is off.
 *
 * Never the stub: a caller that gets `null` must leave records untouched. Throws
 * `AeatCertificateMissingError` or `AeatEnvironmentMismatchError` on a
 * misconfiguration, so it is loud rather than paused.
 */
export function getAeatClient(env: NodeJS.ProcessEnv = process.env): AeatClient | null {
  return resolveMode(env) === 'http' ? createAeatHttpClient(env) : null
}

export { resolveMode as resolveAeatMode, resolveEnvironment as resolveAeatEnvironment }
