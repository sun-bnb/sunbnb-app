/**
 * The SOAP wire protocol for Veri*factu remisión (track 026 phase 7.1b).
 *
 * PURE: envelope in, envelope out. No network, no prisma, no clock — so every
 * branch below is testable against a canned reply, which matters because the
 * interesting cases (accepted-with-errors, duplicate, partial batch) are
 * precisely the ones a live sandbox makes hard to produce on demand.
 *
 * Binding facts, from the committed `SistemaFacturacion.wsdl`:
 *   - **SOAP 1.1** (`http://schemas.xmlsoap.org/soap/envelope/`), not 1.2
 *   - `style="document"`, `use="literal"` — the body holds the payload element
 *     directly, with no RPC wrapper
 *   - `soapAction=""` — an EMPTY action, which still has to be sent as a header
 *
 * ## The outcome that matters most: `AceptadoConErrores`
 *
 * `EstadoRegistro` has three values and only two obvious ones.
 * **`AceptadoConErrores` is an ACCEPTANCE** — AEAT holds the record — carrying
 * errors to be corrected by a later *subsanación*. Treating it as a failure
 * retries a record AEAT already has, forever; treating it as a plain success
 * hides a real defect. Per §7 of the huella spec, a record whose huella does not
 * match arrives exactly this way, so this branch is the only thing that would
 * ever tell us the chain is wrong.
 */

import { DOMParser } from '@xmldom/xmldom'

export const SOAP_ENV_NS = 'http://schemas.xmlsoap.org/soap/envelope/'
export const NS_RESPUESTA =
  'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaSuministro.xsd'
export const NS_SUMINISTRO_INFORMACION_RESP =
  'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd'

/** Wrap a payload document in a SOAP 1.1 envelope. */
export function wrapSoap(payloadXml: string): string {
  // The payload arrives with its own XML declaration; a declaration is only legal
  // at the very start of a document, so it is stripped before embedding.
  const body = payloadXml.replace(/^\s*<\?xml[^?]*\?>\s*/, '')
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}">` +
    '<soapenv:Header/>' +
    `<soapenv:Body>${body}</soapenv:Body>` +
    '</soapenv:Envelope>'
  )
}

// ─── the reply ───────────────────────────────────────────────────────────────

/** `EstadoEnvio` — the whole submission's verdict. */
export type EstadoEnvio = 'Correcto' | 'ParcialmenteCorrecto' | 'Incorrecto'
/** `EstadoRegistro` — one record's verdict. */
export type EstadoRegistro = 'Correcto' | 'AceptadoConErrores' | 'Incorrecto'

export interface RecordReply {
  /** Identifies WHICH record this line answers — never assume batch order. */
  numSerieFactura: string
  issuerNif: string
  fechaExpedicion: string
  estado: EstadoRegistro
  /** AEAT's numeric error code, e.g. 4112. */
  codigoError: number | null
  descripcionError: string | null
  /** Set when AEAT already holds this record — our idempotency signal. */
  duplicado: boolean
}

export interface SubmissionReply {
  estadoEnvio: EstadoEnvio
  /** Código seguro de verificación for the submission, when accepted. */
  csv: string | null
  /** Seconds AEAT asks us to wait before submitting again. */
  tiempoEsperaEnvioSeconds: number | null
  lines: RecordReply[]
}

export class SoapFaultError extends Error {
  constructor(
    message: string,
    readonly faultCode: string | null,
  ) {
    super(message)
    this.name = 'SoapFaultError'
  }
}

export class MalformedReplyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MalformedReplyError'
  }
}

function textOf(parent: Element, ns: string, name: string): string | null {
  const nodes = parent.getElementsByTagNameNS(ns, name)
  const first = nodes.item(0)
  if (!first) return null
  const text = (first.textContent ?? '').trim()
  return text === '' ? null : text
}

/** Direct children only — avoids a nested IDFactura leaking into a parent lookup. */
function childText(parent: Element, ns: string, name: string): string | null {
  for (let i = 0; i < parent.childNodes.length; i += 1) {
    const node = parent.childNodes.item(i)
    if (node && node.nodeType === 1) {
      const el = node as Element
      if (el.namespaceURI === ns && el.localName === name) {
        const text = (el.textContent ?? '').trim()
        return text === '' ? null : text
      }
    }
  }
  return null
}

const ESTADO_ENVIO: EstadoEnvio[] = ['Correcto', 'ParcialmenteCorrecto', 'Incorrecto']
const ESTADO_REGISTRO: EstadoRegistro[] = ['Correcto', 'AceptadoConErrores', 'Incorrecto']

/**
 * Parse AEAT's reply.
 *
 * Throws rather than guessing: a reply we cannot read is not a successful
 * submission, and marking records `sent` on an unparseable response would lose
 * them silently. A SOAP Fault becomes `SoapFaultError` — that is how `4112`
 * (certificate not entitled to act for this obligado) and the other
 * whole-envío rejections arrive, before any per-record line exists.
 */
export function parseSubmissionReply(xml: string): SubmissionReply {
  const doc = new DOMParser({
    // Silence the default console noise; we raise our own error below.
    errorHandler: { warning: () => {}, error: () => {}, fatalError: () => {} },
  }).parseFromString(xml, 'text/xml')

  const root = doc.documentElement
  if (!root) throw new MalformedReplyError('Reply is not XML')

  // A Fault can be the whole answer, so check it before looking for a response.
  const fault = doc.getElementsByTagNameNS(SOAP_ENV_NS, 'Fault').item(0)
  if (fault) {
    // faultcode/faultstring are UNQUALIFIED in SOAP 1.1 — a namespaced lookup
    // finds nothing, which would read as "no fault" and turn a hard rejection
    // into a parse error.
    const code = fault.getElementsByTagName('faultcode').item(0)?.textContent?.trim() ?? null
    const reason =
      fault.getElementsByTagName('faultstring').item(0)?.textContent?.trim() ??
      'SOAP Fault with no faultstring'
    throw new SoapFaultError(reason, code)
  }

  const response = doc
    .getElementsByTagNameNS(NS_RESPUESTA, 'RespuestaRegFactuSistemaFacturacion')
    .item(0)
  if (!response) {
    throw new MalformedReplyError(
      'Reply carries neither a SOAP Fault nor a RespuestaRegFactuSistemaFacturacion',
    )
  }

  const estadoRaw = textOf(response, NS_RESPUESTA, 'EstadoEnvio')
  if (!estadoRaw || !ESTADO_ENVIO.includes(estadoRaw as EstadoEnvio)) {
    throw new MalformedReplyError(`Unknown EstadoEnvio ${JSON.stringify(estadoRaw)}`)
  }

  const esperaRaw = textOf(response, NS_RESPUESTA, 'TiempoEsperaEnvio')
  const espera = esperaRaw === null ? null : Number.parseInt(esperaRaw, 10)

  const lineNodes = response.getElementsByTagNameNS(NS_RESPUESTA, 'RespuestaLinea')
  const lines: RecordReply[] = []
  for (let i = 0; i < lineNodes.length; i += 1) {
    const line = lineNodes.item(i)
    if (!line) continue

    const idFactura = line.getElementsByTagNameNS(NS_SUMINISTRO_INFORMACION_RESP, 'IDFactura').item(0)
    if (!idFactura) {
      throw new MalformedReplyError(`RespuestaLinea ${i} has no IDFactura to identify it`)
    }

    const estadoLineRaw = childText(line, NS_RESPUESTA, 'EstadoRegistro')
    if (!estadoLineRaw || !ESTADO_REGISTRO.includes(estadoLineRaw as EstadoRegistro)) {
      throw new MalformedReplyError(`Unknown EstadoRegistro ${JSON.stringify(estadoLineRaw)}`)
    }

    const codigoRaw = childText(line, NS_RESPUESTA, 'CodigoErrorRegistro')
    const numSerie = textOf(idFactura, NS_SUMINISTRO_INFORMACION_RESP, 'NumSerieFactura')
    const emisor = textOf(idFactura, NS_SUMINISTRO_INFORMACION_RESP, 'IDEmisorFactura')
    const fecha = textOf(idFactura, NS_SUMINISTRO_INFORMACION_RESP, 'FechaExpedicionFactura')
    if (!numSerie || !emisor) {
      throw new MalformedReplyError(`RespuestaLinea ${i} has an incomplete IDFactura`)
    }

    lines.push({
      numSerieFactura: numSerie,
      issuerNif: emisor,
      fechaExpedicion: fecha ?? '',
      estado: estadoLineRaw as EstadoRegistro,
      codigoError: codigoRaw === null ? null : Number.parseInt(codigoRaw, 10),
      descripcionError: childText(line, NS_RESPUESTA, 'DescripcionErrorRegistro'),
      duplicado: childText(line, NS_RESPUESTA, 'RegistroDuplicado') !== null,
    })
  }

  return {
    estadoEnvio: estadoRaw as EstadoEnvio,
    csv: textOf(response, NS_RESPUESTA, 'CSV'),
    tiempoEsperaEnvioSeconds: espera !== null && Number.isFinite(espera) ? espera : null,
    lines,
  }
}

/**
 * Did AEAT take this record?
 *
 * `AceptadoConErrores` counts as taken — see the module header. The errors still
 * need surfacing, which is what `lastError` on the record is for.
 */
export function isAccepted(line: RecordReply): boolean {
  return (
    line.estado === 'Correcto' || line.estado === 'AceptadoConErrores' || line.duplicado
  )
}
