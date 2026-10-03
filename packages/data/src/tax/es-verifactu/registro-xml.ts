/**
 * The wire format: `RegistroAlta` and the `RegFactuSistemaFacturacion` envelope
 * (track 026 phase 7.1).
 *
 * PURE. No prisma, no clock, no network.
 *
 * Written against AEAT's published schemas, which are committed beside this file
 * in `schemas/` so the element order can be checked without the network:
 *   - `SuministroLR.xsd`            — the `RegFactuSistemaFacturacion` root
 *   - `SuministroInformacion.xsd`   — `CabeceraType`, `RegistroFacturacionAltaType`
 *   - `RespuestaSuministro.xsd`     — the reply
 *   - `SistemaFacturacion.wsdl`     — endpoints (see `ENDPOINTS` below)
 *
 * ## Element ORDER is load-bearing
 *
 * Every complexType here is an xsd:sequence, so the elements must appear in the
 * schema's order, not a convenient one. An out-of-order document is rejected
 * with `4102 = El XML no cumple el esquema`, which says nothing about which
 * element moved. The order below is copied from the XSD and the unit tests assert
 * it, because it is not guessable and not obvious from the field names.
 *
 * ## Building the payload EARLY, and freezing it
 *
 * The per-record fragment is generated inside the invoice's transaction and
 * stored on the record, rather than rendered at submission time. Same reasoning
 * the schema already gives for `issuerNif`: "identity as it goes on the wire,
 * frozen at generation. Re-deriving it later would let a corrected partner NIF
 * silently change what was filed." That argument extends to every field the
 * huella covers — if the payload were rebuilt from the invoice at send time, an
 * edited invoice would produce a document whose huella no longer matches its own
 * contents, and AEAT would accept it *with errors* rather than reject it (§7 of
 * the huella spec), so nothing would surface the drift.
 *
 * The **Cabecera is not frozen**, because it is per-submission rather than
 * per-record and carries the `Representante` — which does not exist until the
 * colaboración social grant does.
 */

import type { DesgloseEntry, TipoFactura } from './tipo-factura'
import type { SistemaInformatico } from './sistema-informatico'

/** The two namespaces the document uses. Note `tike`, not `tikeV1.0` — the
 *  targetNamespace differs from the path the schema is downloaded from. */
export const NS_SUMINISTRO_LR =
  'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd'
export const NS_SUMINISTRO_INFORMACION =
  'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd'

/** `IDVersion` — the schema permits exactly one value. */
export const ID_VERSION = '1.0'
/** `TipoHuella` — `01` is SHA-256, the only value the schema allows. */
export const TIPO_HUELLA_SHA256 = '01'

/**
 * The remisión endpoints, from `SistemaFacturacion.wsdl`.
 *
 * **The host selects which kind of certificate you present.** `www1`/`prewww1`
 * expect a *representante* (or persona física) certificate; `www10`/`prewww10`
 * are the `…Sello` ports and expect a *certificado de sello electrónico*. We hold
 * an FNMT Certificado de Representante de Persona Jurídica, so we use the
 * non-Sello hosts. Pointing at `www10` with a representative certificate fails at
 * the TLS layer, which looks like a network fault rather than a wrong endpoint.
 */
export const ENDPOINTS = {
  production: 'https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
  pruebas: 'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
  /** Same service, for a certificado de sello electrónico. Unused — see above. */
  productionSello:
    'https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
  pruebasSello: 'https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
} as const

// ─── serialization helpers ───────────────────────────────────────────────────

/** Escape text for an element body or attribute value. */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function el(name: string, value: string): string {
  // Names the element rather than dying inside `replace` on undefined. The types
  // make this unreachable from TypeScript, but a hand-built SistemaInformatico in
  // a test reached it once, and "Cannot read properties of undefined" says
  // nothing about which of the thirty-odd fields was missing.
  if (typeof value !== 'string') {
    throw new Error(`RegistroAlta element ${name} has no value (got ${typeof value})`)
  }
  return `<sf:${name}>${xmlEscape(value)}</sf:${name}>`
}

// ─── the record ──────────────────────────────────────────────────────────────

/** Identity of one invoice, for `IDFactura` and for chaining. */
export interface InvoiceRef {
  issuerNif: string
  numSerieFactura: string
  /** `DD-MM-YYYY`. */
  fechaExpedicion: string
}

export type Encadenamiento =
  /** `PrimerRegistro = S` — the first record of this issuer's chain. */
  | { first: true }
  /** The preceding record, identified and hashed. */
  | { first: false; previous: InvoiceRef & { huella: string } }

export interface RegistroAltaXmlInput {
  /** The obligated issuer's tax id. */
  issuerNif: string
  /** `NombreRazonEmisor` — mandatory, max 120 chars. */
  nombreRazonEmisor: string
  numSerieFactura: string
  /** `DD-MM-YYYY` in the issuer's territory. */
  fechaExpedicion: string
  tipoFactura: TipoFactura
  /**
   * `S` when this record CORRECTS one already generated — an *alta de
   * subsanación*. See `subsanacion.ts` for when that applies.
   */
  subsanacion?: 'S' | 'N' | null
  /**
   * Says what happened to the record being corrected. The schema's own
   * documentation for this field is a copy-paste error ("Clave del tipo de
   * factura"), so these meanings come from the validations document's operations
   * table (v1.2.2):
   *
   *   - **absent / `N`** — the record EXISTS at AEAT. The ordinary case, and the
   *     one our `AceptadoConErrores` records fall into.
   *   - **`X`** — the record does NOT exist at AEAT, because the earlier
   *     submission was rejected or never sent.
   *   - **`S`** — the record exists at AEAT and a PREVIOUS subsanación of it was
   *     rejected.
   *
   * Two hard rules (validations doc §3.1.1): `X` may only appear when
   * `Subsanacion = S`, and `S` may not appear unless `Subsanacion = S`.
   */
  rechazoPrevio?: 'S' | 'N' | 'X' | null
  /** `S` (sustitución) or `I` (diferencias). Required on a rectificativa. */
  tipoRectificativa?: 'S' | 'I' | null
  /** The invoices this one rectifies, when it is an R-type. */
  facturasRectificadas?: InvoiceRef[]
  /** `DescripcionOperacion` — mandatory, max 500 chars. */
  descripcionOperacion: string
  /** `Destinatarios`. Omitted on a factura simplificada, which has no recipient. */
  destinatarios?: { nombreRazon: string; nif: string }[]
  desglose: DesgloseEntry[]
  /** Total VAT, ALREADY serialized by `formatImporte` so it matches the huella. */
  cuotaTotal: string
  /** Invoice total, ALREADY serialized by `formatImporte`. */
  importeTotal: string
  encadenamiento: Encadenamiento
  sistemaInformatico: SistemaInformatico
  /** ISO 8601 with a real offset. */
  fechaHoraHusoGenRegistro: string
  huella: string
}

function desgloseXml(entries: DesgloseEntry[]): string {
  // DetalleType order: Impuesto?, ClaveRegimen?, (CalificacionOperacion |
  // OperacionExenta), TipoImpositivo?, BaseImponibleOimporteNoSujeto,
  // BaseImponibleACoste?, CuotaRepercutida?, …
  //
  // `Impuesto` and `ClaveRegimen` are optional and default to IVA / régimen
  // general, which is what every line we emit is. They are written explicitly
  // anyway: a default that is correct today is invisible when it stops being.
  return entries
    .map(
      (e) =>
        '<sf:DetalleDesglose>' +
        el('Impuesto', '01') +
        el('ClaveRegimen', '01') +
        el('CalificacionOperacion', e.calificacionOperacion) +
        el('TipoImpositivo', e.tipoImpositivo.toFixed(2)) +
        el('BaseImponibleOimporteNoSujeto', e.baseImponible.toFixed(2)) +
        el('CuotaRepercutida', e.cuotaRepercutida.toFixed(2)) +
        '</sf:DetalleDesglose>',
    )
    .join('')
}

function sistemaInformaticoXml(si: SistemaInformatico): string {
  // SistemaInformaticoType order: NombreRazon, (NIF | IDOtro),
  // NombreSistemaInformatico, IdSistemaInformatico, Version, NumeroInstalacion,
  // TipoUsoPosibleSoloVerifactu, TipoUsoPosibleMultiOT, IndicadorMultiplesOT.
  return (
    '<sf:SistemaInformatico>' +
    el('NombreRazon', si.nombreRazon) +
    el('NIF', si.nif) +
    el('NombreSistemaInformatico', si.nombreSistemaInformatico) +
    el('IdSistemaInformatico', si.idSistemaInformatico) +
    el('Version', si.version) +
    el('NumeroInstalacion', si.numeroInstalacion) +
    el('TipoUsoPosibleSoloVerifactu', si.tipoUsoPosibleSoloVerifactu) +
    el('TipoUsoPosibleMultiOT', si.tipoUsoPosibleMultiOT) +
    el('IndicadorMultiplesOT', si.indicadorMultiplesOT) +
    '</sf:SistemaInformatico>'
  )
}

function invoiceRefXml(tag: string, ref: InvoiceRef, huella?: string): string {
  return (
    `<sf:${tag}>` +
    el('IDEmisorFactura', ref.issuerNif) +
    el('NumSerieFactura', ref.numSerieFactura) +
    el('FechaExpedicionFactura', ref.fechaExpedicion) +
    (huella === undefined ? '' : el('Huella', huella)) +
    `</sf:${tag}>`
  )
}

/**
 * One `RegistroFactura` wrapping one `RegistroAlta`, ready to be dropped into a
 * submission. This is what gets frozen on the record.
 *
 * Both namespaces are declared on the fragment even though the envelope declares
 * them too. Redundant declarations are legal, and it makes the stored fragment
 * parseable on its own — which matters when the thing you need to inspect is a
 * record AEAT rejected months ago.
 */
export function buildRegistroAltaXml(input: RegistroAltaXmlInput): string {
  const isRectificativa = input.tipoFactura.startsWith('R')

  // The two co-dependency rules, enforced here rather than discovered as a
  // rejection. AEAT states them as validations, so a document breaking them is
  // refused — and the error would name neither field.
  if (input.rechazoPrevio === 'X' && input.subsanacion !== 'S') {
    throw new Error('RechazoPrevio=X is only valid when Subsanacion=S')
  }
  if (input.rechazoPrevio === 'S' && input.subsanacion !== 'S') {
    throw new Error('RechazoPrevio=S is only valid when Subsanacion=S')
  }

  // RegistroFacturacionAltaType, in schema order. Optional elements we never
  // emit (RefExterna, Subsanacion, RechazoPrevio, FacturasSustituidas,
  // ImporteRectificacion, FechaOperacion, FacturaSimplificadaArt7273,
  // FacturaSinIdentifDestinatarioArt61d, Macrodato,
  // EmitidaPorTerceroODestinatario, Tercero, Cupon,
  // NumRegistroAcuerdoFacturacion, IdAcuerdoSistemaInformatico, ds:Signature)
  // are simply absent.
  const parts: string[] = [
    el('IDVersion', ID_VERSION),
    invoiceRefXml('IDFactura', {
      issuerNif: input.issuerNif,
      numSerieFactura: input.numSerieFactura,
      fechaExpedicion: input.fechaExpedicion,
    }),
    el('NombreRazonEmisor', input.nombreRazonEmisor),
  ]

  // Subsanacion and RechazoPrevio sit BETWEEN NombreRazonEmisor and TipoFactura
  // in the schema sequence. Putting them anywhere else is schema-invalid.
  if (input.subsanacion) parts.push(el('Subsanacion', input.subsanacion))
  if (input.rechazoPrevio) parts.push(el('RechazoPrevio', input.rechazoPrevio))

  parts.push(el('TipoFactura', input.tipoFactura))

  if (isRectificativa && input.tipoRectificativa) {
    parts.push(el('TipoRectificativa', input.tipoRectificativa))
  }
  if (input.facturasRectificadas && input.facturasRectificadas.length > 0) {
    parts.push(
      '<sf:FacturasRectificadas>' +
        input.facturasRectificadas
          .map((r) => invoiceRefXml('IDFacturaRectificada', r))
          .join('') +
        '</sf:FacturasRectificadas>',
    )
  }

  parts.push(el('DescripcionOperacion', input.descripcionOperacion))

  if (input.destinatarios && input.destinatarios.length > 0) {
    parts.push(
      '<sf:Destinatarios>' +
        input.destinatarios
          .map(
            (d) =>
              '<sf:IDDestinatario>' +
              el('NombreRazon', d.nombreRazon) +
              el('NIF', d.nif) +
              '</sf:IDDestinatario>',
          )
          .join('') +
        '</sf:Destinatarios>',
    )
  }

  parts.push('<sf:Desglose>' + desgloseXml(input.desglose) + '</sf:Desglose>')
  parts.push(el('CuotaTotal', input.cuotaTotal))
  parts.push(el('ImporteTotal', input.importeTotal))

  parts.push(
    '<sf:Encadenamiento>' +
      (input.encadenamiento.first
        ? el('PrimerRegistro', 'S')
        : invoiceRefXml(
            'RegistroAnterior',
            input.encadenamiento.previous,
            input.encadenamiento.previous.huella,
          )) +
      '</sf:Encadenamiento>',
  )

  parts.push(sistemaInformaticoXml(input.sistemaInformatico))
  parts.push(el('FechaHoraHusoGenRegistro', input.fechaHoraHusoGenRegistro))
  parts.push(el('TipoHuella', TIPO_HUELLA_SHA256))
  parts.push(el('Huella', input.huella))

  return (
    `<sfLR:RegistroFactura xmlns:sfLR="${NS_SUMINISTRO_LR}" xmlns:sf="${NS_SUMINISTRO_INFORMACION}">` +
    '<sf:RegistroAlta>' +
    parts.join('') +
    '</sf:RegistroAlta>' +
    '</sfLR:RegistroFactura>'
  )
}

// ─── the envelope ────────────────────────────────────────────────────────────

export interface CabeceraInput {
  /** The obligated issuer — one per submission. */
  obligadoEmision: { nombreRazon: string; nif: string }
  /**
   * Us, when submitting for somebody else under colaboración social. Omitted
   * when we ARE the obligado, which is the case for our own commission invoices.
   */
  representante?: { nombreRazon: string; nif: string }
}

/**
 * The full `RegFactuSistemaFacturacion` document.
 *
 * A submission carries exactly ONE `ObligadoEmision`, so it is structurally
 * single-issuer — never mix issuers into one message. That is reinforced by
 * `4112` (the certificate holder must be Obligado Emisión, Colaborador Social,
 * Apoderado or Sucesor), which rejects the WHOLE envío rather than one record.
 *
 * `maxOccurs="1000"` on `RegistroFactura` is the batch ceiling.
 */
export const MAX_RECORDS_PER_SUBMISSION = 1000

export function buildSubmissionXml(
  cabecera: CabeceraInput,
  registroFragments: string[],
): string {
  if (registroFragments.length === 0) {
    throw new Error('A submission needs at least one RegistroFactura')
  }
  if (registroFragments.length > MAX_RECORDS_PER_SUBMISSION) {
    throw new Error(
      `A submission carries at most ${MAX_RECORDS_PER_SUBMISSION} records; got ${registroFragments.length}`,
    )
  }

  // `Cabecera` is declared LOCALLY inside RegFactuSistemaFacturacion in
  // SuministroLR.xsd, so with elementFormDefault="qualified" the ELEMENT belongs
  // to the SuministroLR namespace even though its TYPE (CabeceraType) comes from
  // SuministroInformacion. Its children are declared inside that type, so they
  // are in the sf namespace. Getting this backwards is schema-invalid and the
  // error only names the element, not the reason.
  //
  // CabeceraType order: ObligadoEmision, Representante?, RemisionVoluntaria?
  const cab =
    '<sfLR:Cabecera>' +
    '<sf:ObligadoEmision>' +
    el('NombreRazon', cabecera.obligadoEmision.nombreRazon) +
    el('NIF', cabecera.obligadoEmision.nif) +
    '</sf:ObligadoEmision>' +
    (cabecera.representante
      ? '<sf:Representante>' +
        el('NombreRazon', cabecera.representante.nombreRazon) +
        el('NIF', cabecera.representante.nif) +
        '</sf:Representante>'
      : '') +
    '</sfLR:Cabecera>'

  // The stored fragments carry their own redundant namespace declarations; that
  // is legal and deliberate (see buildRegistroAltaXml).
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<sfLR:RegFactuSistemaFacturacion xmlns:sfLR="${NS_SUMINISTRO_LR}" xmlns:sf="${NS_SUMINISTRO_INFORMACION}">` +
    cab +
    registroFragments.join('') +
    '</sfLR:RegFactuSistemaFacturacion>'
  )
}
