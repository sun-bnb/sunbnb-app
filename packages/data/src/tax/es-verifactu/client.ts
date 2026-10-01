/**
 * The AEAT submission client — stub and real (track 026 phase 7.1b).
 *
 * `getAeatClient()` is the ONE place that decides stub vs real HTTP, mirroring
 * `packages/data/src/viva/index.ts`, so the sweep never branches on env itself.
 *
 * Mode resolution:
 *  - `AEAT_MODE=stub` → stub, always.
 *  - `AEAT_MODE=http` → real client, always; **throws if the certificate is
 *    missing** rather than quietly degrading.
 *  - unset, `AEAT_CERT_PFX_BASE64` present → real client.
 *  - unset, no certificate → stub. This is what lets CI and a laptop run the
 *    whole sweep with no secret at all.
 *
 * ## Why a missing certificate must FAIL, never skip
 *
 * The one thing worse than not submitting is believing we submitted. If `http`
 * mode fell back to the stub when the certificate was absent, a production
 * misconfiguration would mark every record `sent` against a stub that accepted
 * everything, and the register would read complete while AEAT had nothing. So the
 * fallback only exists when the mode was never explicitly requested.
 *
 * ## Certificate handling
 *
 * `AEAT_CERT_PFX_BASE64` + `AEAT_CERT_PASSWORD` as Vercel encrypted env vars,
 * decoded into an https.Agent per cold start and never written to disk. One
 * certificate for the whole platform (D2: colaboración social under Convenio 17),
 * which is what makes a single env pair sufficient — we never hold a partner's
 * own certificate.
 */

import https from 'node:https'
import { ENDPOINTS } from './registro-xml'
import { parseSubmissionReply, wrapSoap, type SubmissionReply } from './soap'

export type AeatMode = 'stub' | 'http'
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

function resolveEnvironment(env: NodeJS.ProcessEnv): AeatEnvironment {
  // Default to pruebas. A wrong guess toward the sandbox costs a re-run; a wrong
  // guess toward production files real records from a dev machine.
  return env.AEAT_ENV === 'production' ? 'production' : 'pruebas'
}

function resolveMode(env: NodeJS.ProcessEnv): AeatMode {
  const explicit = env.AEAT_MODE
  if (explicit === 'stub' || explicit === 'http') return explicit
  return env.AEAT_CERT_PFX_BASE64 ? 'http' : 'stub'
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

export function getAeatClient(env: NodeJS.ProcessEnv = process.env): AeatClient {
  return resolveMode(env) === 'http' ? createAeatHttpClient(env) : createStubAeatClient()
}

export { resolveMode as resolveAeatMode, resolveEnvironment as resolveAeatEnvironment }
