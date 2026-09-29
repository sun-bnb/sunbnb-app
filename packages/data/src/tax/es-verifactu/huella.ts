/**
 * The Veri*factu *huella* — the chained SHA-256 fingerprint of a billing record
 * (track 026 phase 5).
 *
 * PURE. No prisma, no clock, no I/O: every input is passed in, which is what
 * makes it testable against a published vector.
 *
 * ## Provenance — the official document
 *
 * Field order, format, trimming and output encoding all come from AEAT's
 * "Detalle de las especificaciones técnicas para generación de la huella o hash
 * de los registros de facturación", **v0.1.2, 27/08/2024**, §3–§6. All three of
 * that document's worked examples are pinned as tests: a first alta, a chained
 * alta, and an anulación.
 *
 * `HUELLA_SPEC_VERSION` records which revision produced a stored huella. The
 * document is versioned and has already been revised twice (0.1.1 corrected the
 * anulación example, 0.1.2 clarified numeric handling), so a future revision
 * that changes the string must stay distinguishable rather than being silently
 * mixed into one unverifiable chain. AEAT allows restarting a chain with
 * `PrimerRegistro='S'` if it comes to that.
 *
 * ## A wrong huella does not bounce — it is "Aceptado con errores"
 *
 * §7: when the huella a system submits does not match AEAT's own recomputation,
 * the record is accepted **with errors**, not rejected. So a format mistake does
 * not announce itself on the first submission; it accumulates silently across a
 * chain. That is precisely why the vectors below are tests rather than a comment.
 *
 * ## The formatting rule that matters
 *
 * Every input is a STRING, deliberately. The specification says to hash the
 * same serialized strings that go into the XML rather than reformatting them,
 * so whatever decimal and date conventions AEAT expects are respected by
 * construction. Taking numbers here and formatting them internally would create
 * a second opinion about `12.35` versus `12.350` — and the two opinions would
 * disagree exactly once, in production, unrecoverably.
 */

import { createHash } from 'crypto'

/** Bump when the canonical string changes. Stored per record. */
export const HUELLA_SPEC_VERSION = 'aeat-huella-v0.1.2'

/** SHA-256, UTF-8 input, UPPERCASE hex output — 64 characters. */
function sha256Upper(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex').toUpperCase()
}

/**
 * Fields of a `RegistroAlta`, already serialized exactly as the XML carries
 * them. `huellaAnterior` is the empty string for the first record in a chain.
 */
export interface AltaHuellaInput {
  idEmisorFactura: string
  numSerieFactura: string
  /** `DD-MM-YYYY`, in the issuer's territory. */
  fechaExpedicionFactura: string
  /** `F1` · `F2` · `R1`–`R5`. */
  tipoFactura: string
  /** Total VAT, as serialized. */
  cuotaTotal: string
  /** Gross total, as serialized. */
  importeTotal: string
  /** The previous record's huella, or '' to open the chain. */
  huellaAnterior: string
  /** ISO 8601 WITH offset, e.g. `2026-07-10T19:20:30+02:00`. */
  fechaHoraHusoGenRegistro: string
}

/**
 * One `nombre=valor` pair.
 *
 * TRIMS the value, per §3: "eliminando los espacios al inicio y al final de
 * cada valor" — the document's own Java reference does `valor.trim()`. An
 * untrimmed value would hash differently from the same invoice submitted by any
 * conforming system, and §7 means that disagreement surfaces as "accepted with
 * errors" rather than a rejection, so it would not announce itself.
 *
 * A null or absent value renders as the bare name and `=`, per §3 and the
 * reference's `(valor == null) ? "" : valor.trim()`.
 */
function field(name: string, value: string | null | undefined): string {
  return `${name}=${(value ?? '').trim()}`
}

/** The canonical string, exposed so a rejection can be debugged against it. */
export function altaHuellaInputString(input: AltaHuellaInput): string {
  return [
    field('IDEmisorFactura', input.idEmisorFactura),
    field('NumSerieFactura', input.numSerieFactura),
    field('FechaExpedicionFactura', input.fechaExpedicionFactura),
    field('TipoFactura', input.tipoFactura),
    field('CuotaTotal', input.cuotaTotal),
    field('ImporteTotal', input.importeTotal),
    field('Huella', input.huellaAnterior),
    field('FechaHoraHusoGenRegistro', input.fechaHoraHusoGenRegistro),
  ].join('&')
}

export function computeAltaHuella(input: AltaHuellaInput): string {
  return sha256Upper(altaHuellaInputString(input))
}

/** Fields of a `RegistroAnulacion` — voiding a record issued in error. */
export interface AnulacionHuellaInput {
  idEmisorFacturaAnulada: string
  numSerieFacturaAnulada: string
  fechaExpedicionFacturaAnulada: string
  huellaAnterior: string
  fechaHoraHusoGenRegistro: string
}

export function anulacionHuellaInputString(input: AnulacionHuellaInput): string {
  return [
    field('IDEmisorFacturaAnulada', input.idEmisorFacturaAnulada),
    field('NumSerieFacturaAnulada', input.numSerieFacturaAnulada),
    field('FechaExpedicionFacturaAnulada', input.fechaExpedicionFacturaAnulada),
    field('Huella', input.huellaAnterior),
    field('FechaHoraHusoGenRegistro', input.fechaHoraHusoGenRegistro),
  ].join('&')
}

export function computeAnulacionHuella(input: AnulacionHuellaInput): string {
  return sha256Upper(anulacionHuellaInputString(input))
}

// ─── Serialization helpers ───────────────────────────────────────────────────
//
// These produce the strings that go into BOTH the XML and the huella, so the
// two cannot disagree. Use them; do not format at a call site.

/**
 * Money as AEAT expects it: two decimals, dot separator.
 *
 * §3 says one or two decimal places are treated indistinctly and trailing zeros
 * are irrelevant — `123.1` and `123.10` are both valid for the same invoice. Two
 * decimals is therefore a choice, not a requirement, and it is the one made here
 * so the string hashed is the string the XML carries.
 */
export function formatImporte(value: number): string {
  return value.toFixed(2)
}

/**
 * `DD-MM-YYYY` in the ISSUER'S territory.
 *
 * The timezone argument is not decoration. `Invoice.invoicedAt` is UTC, and a
 * sale at 22:30 UTC in summer is already the next day in Madrid — so taking the
 * date off the UTC instant files the record under the wrong day. The venue's
 * timezone is on `Site.timeZone` (track 017).
 */
export function formatFechaExpedicion(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('day')}-${get('month')}-${get('year')}`
}

/**
 * ISO 8601 with a real UTC offset, e.g. `2026-07-10T19:20:30+02:00`.
 *
 * Not `toISOString()`, which always renders `Z`: the field is named *Huso*
 * (timezone) and carries the issuer's offset, so a Spanish record stamped `Z`
 * would be an hour or two off its own wall clock all year.
 */
export function formatFechaHoraHusoGenRegistro(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  // `en-GB` renders midnight as 24; ISO wants 00.
  const hour = get('hour') === '24' ? '00' : get('hour')
  const local = `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}`

  // Derive the offset by comparing the wall clock in that zone against UTC.
  const asUtc = Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    Number(hour),
    Number(get('minute')),
    Number(get('second')),
  )
  const offsetMinutes = Math.round((asUtc - at.getTime()) / 60000)
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${local}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}
