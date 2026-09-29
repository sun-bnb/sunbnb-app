/**
 * The Veri*factu *huella* — the chained SHA-256 fingerprint of a billing record
 * (track 026 phase 5).
 *
 * PURE. No prisma, no clock, no I/O: every input is passed in, which is what
 * makes it testable against a published vector.
 *
 * ## Provenance, and why you should re-check it
 *
 * The canonical field order below was taken from a third-party implementation
 * citing AEAT, and CONFIRMED self-consistent: the vector in `huella.test.ts`
 * hashes to exactly the value that source publishes. The field list also
 * matches the one AEAT's own FAQ describes in prose.
 *
 * That is good evidence, not proof. The FAQ defers the detail to a separate
 * document ("Detalle de las especificaciones técnicas para la generación de la
 * huella o hash de los registros") which was not retrievable when this was
 * written. **Before the first real submission, confirm the field order and
 * formatting against that document.** This is the highest-cost error in the
 * project: every record is built on the one before it, so a format mistake is
 * only discovered once a chain exists.
 *
 * `HUELLA_SPEC_VERSION` is stored on every record precisely so a correction
 * stays distinguishable rather than silently mixed into one unverifiable chain.
 * AEAT permits restarting a chain with `PrimerRegistro='S'`, which is the
 * escape hatch if this turns out to be wrong.
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
export const HUELLA_SPEC_VERSION = 'aeat-2024-alta-v1'

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

/** The canonical string, exposed so a rejection can be debugged against it. */
export function altaHuellaInputString(input: AltaHuellaInput): string {
  return [
    `IDEmisorFactura=${input.idEmisorFactura}`,
    `NumSerieFactura=${input.numSerieFactura}`,
    `FechaExpedicionFactura=${input.fechaExpedicionFactura}`,
    `TipoFactura=${input.tipoFactura}`,
    `CuotaTotal=${input.cuotaTotal}`,
    `ImporteTotal=${input.importeTotal}`,
    `Huella=${input.huellaAnterior}`,
    `FechaHoraHusoGenRegistro=${input.fechaHoraHusoGenRegistro}`,
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
    `IDEmisorFacturaAnulada=${input.idEmisorFacturaAnulada}`,
    `NumSerieFacturaAnulada=${input.numSerieFacturaAnulada}`,
    `FechaExpedicionFacturaAnulada=${input.fechaExpedicionFacturaAnulada}`,
    `Huella=${input.huellaAnterior}`,
    `FechaHoraHusoGenRegistro=${input.fechaHoraHusoGenRegistro}`,
  ].join('&')
}

export function computeAnulacionHuella(input: AnulacionHuellaInput): string {
  return sha256Upper(anulacionHuellaInputString(input))
}

// ─── Serialization helpers ───────────────────────────────────────────────────
//
// These produce the strings that go into BOTH the XML and the huella, so the
// two cannot disagree. Use them; do not format at a call site.

/** Money as AEAT expects it: two decimals, dot separator. */
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
