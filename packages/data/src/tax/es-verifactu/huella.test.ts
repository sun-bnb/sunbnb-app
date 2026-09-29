import { describe, it, expect } from 'vitest'
import {
  altaHuellaInputString,
  anulacionHuellaInputString,
  computeAltaHuella,
  computeAnulacionHuella,
  formatFechaExpedicion,
  formatFechaHoraHusoGenRegistro,
  formatImporte,
  HUELLA_SPEC_VERSION,
} from './huella'

/**
 * The golden vector is the whole point of this file.
 *
 * A chained hash cannot be checked by inspection, and it cannot be checked
 * against AEAT without a certificate and a network — so the ONLY way to have
 * confidence before the first submission is a published input/output pair.
 * If this test fails, the canonical string changed and every record already
 * written under the old one is unverifiable.
 */
const AEAT_VECTOR = {
  input: {
    idEmisorFactura: '89890001K',
    numSerieFactura: '12345678/G33',
    fechaExpedicionFactura: '01-01-2024',
    tipoFactura: 'F1',
    cuotaTotal: '12.35',
    importeTotal: '123.45',
    huellaAnterior: '',
    fechaHoraHusoGenRegistro: '2024-01-01T19:20:30+01:00',
  },
  expectedString:
    'IDEmisorFactura=89890001K&NumSerieFactura=12345678/G33&FechaExpedicionFactura=01-01-2024' +
    '&TipoFactura=F1&CuotaTotal=12.35&ImporteTotal=123.45&Huella=' +
    '&FechaHoraHusoGenRegistro=2024-01-01T19:20:30+01:00',
  expectedHuella: '3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60',
}

describe('RegistroAlta huella — golden vector', () => {
  it('builds the canonical string exactly', () => {
    expect(altaHuellaInputString(AEAT_VECTOR.input)).toBe(AEAT_VECTOR.expectedString)
  })

  it('produces the published hash', () => {
    expect(computeAltaHuella(AEAT_VECTOR.input)).toBe(AEAT_VECTOR.expectedHuella)
  })

  it('is UPPERCASE hex, 64 characters', () => {
    expect(computeAltaHuella(AEAT_VECTOR.input)).toMatch(/^[0-9A-F]{64}$/)
  })

  it('opens a chain with an EMPTY previous huella, not a seed value', () => {
    expect(altaHuellaInputString(AEAT_VECTOR.input)).toContain('&Huella=&')
  })

  it.each([
    ['idEmisorFactura', { idEmisorFactura: '89890001L' }],
    ['numSerieFactura', { numSerieFactura: '12345678/G34' }],
    ['fechaExpedicionFactura', { fechaExpedicionFactura: '02-01-2024' }],
    ['tipoFactura', { tipoFactura: 'F2' }],
    ['cuotaTotal', { cuotaTotal: '12.36' }],
    ['importeTotal', { importeTotal: '123.46' }],
    ['huellaAnterior', { huellaAnterior: AEAT_VECTOR.expectedHuella }],
    ['fechaHoraHusoGenRegistro', { fechaHoraHusoGenRegistro: '2024-01-01T19:20:31+01:00' }],
  ])('changes when %s changes', (_field, patch) => {
    expect(computeAltaHuella({ ...AEAT_VECTOR.input, ...patch })).not.toBe(
      AEAT_VECTOR.expectedHuella,
    )
  })

  it('records which spec version produced it', () => {
    // Stored per record so a corrected format stays distinguishable rather than
    // silently mixed into one unverifiable chain.
    expect(HUELLA_SPEC_VERSION).toBe('aeat-2024-alta-v1')
  })
})

describe('RegistroAnulacion huella', () => {
  it('uses the five-field order, with the annulled invoice identified', () => {
    expect(
      anulacionHuellaInputString({
        idEmisorFacturaAnulada: '89890001K',
        numSerieFacturaAnulada: '12345678/G33',
        fechaExpedicionFacturaAnulada: '01-01-2024',
        huellaAnterior: '',
        fechaHoraHusoGenRegistro: '2024-01-01T19:20:30+01:00',
      }),
    ).toBe(
      'IDEmisorFacturaAnulada=89890001K&NumSerieFacturaAnulada=12345678/G33' +
        '&FechaExpedicionFacturaAnulada=01-01-2024&Huella=' +
        '&FechaHoraHusoGenRegistro=2024-01-01T19:20:30+01:00',
    )
  })

  it('is a different hash from an alta over the same invoice', () => {
    // The field NAMES differ, so a void can never collide with the record it
    // voids — which is what stops one being mistaken for the other in a chain.
    const alta = computeAltaHuella(AEAT_VECTOR.input)
    const anulacion = computeAnulacionHuella({
      idEmisorFacturaAnulada: AEAT_VECTOR.input.idEmisorFactura,
      numSerieFacturaAnulada: AEAT_VECTOR.input.numSerieFactura,
      fechaExpedicionFacturaAnulada: AEAT_VECTOR.input.fechaExpedicionFactura,
      huellaAnterior: '',
      fechaHoraHusoGenRegistro: AEAT_VECTOR.input.fechaHoraHusoGenRegistro,
    })
    expect(anulacion).not.toBe(alta)
  })
})

describe('serialization helpers', () => {
  it('formats money to two decimals', () => {
    expect(formatImporte(123.4)).toBe('123.40')
    expect(formatImporte(12.345)).toBe('12.35')
    expect(formatImporte(-121)).toBe('-121.00')
  })

  it('takes the expedition date in the ISSUER territory, not UTC', () => {
    // 22:30 UTC on 9 July is already 10 July in Madrid (UTC+2 in summer).
    // Taking the date off the UTC instant files the record under the wrong day.
    const at = new Date('2026-07-09T22:30:00Z')
    expect(formatFechaExpedicion(at, 'Europe/Madrid')).toBe('10-07-2026')
    expect(formatFechaExpedicion(at, 'UTC')).toBe('09-07-2026')
  })

  it('stamps the generation time with a real offset, never Z', () => {
    // The field is named *Huso* — timezone. A Spanish record stamped Z would be
    // one or two hours off its own wall clock all year.
    const summer = new Date('2026-07-09T17:20:30Z')
    expect(formatFechaHoraHusoGenRegistro(summer, 'Europe/Madrid')).toBe(
      '2026-07-09T19:20:30+02:00',
    )
  })

  it('follows the issuer across a DST boundary', () => {
    // Madrid is +01:00 in winter and +02:00 in summer; a hardcoded offset is
    // wrong for half the year, which on a beach business is the busy half.
    const winter = new Date('2026-01-15T18:20:30Z')
    expect(formatFechaHoraHusoGenRegistro(winter, 'Europe/Madrid')).toBe(
      '2026-01-15T19:20:30+01:00',
    )
  })

  it('renders UTC as +00:00', () => {
    expect(formatFechaHoraHusoGenRegistro(new Date('2026-07-09T17:20:30Z'), 'UTC')).toBe(
      '2026-07-09T17:20:30+00:00',
    )
  })

  it('renders midnight as 00, not 24', () => {
    expect(
      formatFechaHoraHusoGenRegistro(new Date('2026-07-09T22:00:00Z'), 'Europe/Madrid'),
    ).toBe('2026-07-10T00:00:00+02:00')
  })
})
