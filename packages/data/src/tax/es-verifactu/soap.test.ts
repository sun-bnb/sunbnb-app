import { describe, it, expect } from 'vitest'
import {
  wrapSoap,
  parseSubmissionReply,
  isAccepted,
  SoapFaultError,
  MalformedReplyError,
  NS_RESPUESTA,
  NS_SUMINISTRO_INFORMACION_RESP,
  SOAP_ENV_NS,
} from './soap'

function reply(body: string): string {
  return (
    `<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}"><soapenv:Body>` +
    `<sfR:RespuestaRegFactuSistemaFacturacion xmlns:sfR="${NS_RESPUESTA}" xmlns:sf="${NS_SUMINISTRO_INFORMACION_RESP}">` +
    body +
    '</sfR:RespuestaRegFactuSistemaFacturacion></soapenv:Body></soapenv:Envelope>'
  )
}

function line(num: string, estado: string, extra = ''): string {
  return (
    '<sfR:RespuestaLinea>' +
    '<sf:IDFactura>' +
    '<sf:IDEmisorFactura>B22435705</sf:IDEmisorFactura>' +
    `<sf:NumSerieFactura>${num}</sf:NumSerieFactura>` +
    '<sf:FechaExpedicionFactura>10-07-2026</sf:FechaExpedicionFactura>' +
    '</sf:IDFactura>' +
    '<sf:Operacion>Alta</sf:Operacion>' +
    `<sfR:EstadoRegistro>${estado}</sfR:EstadoRegistro>` +
    extra +
    '</sfR:RespuestaLinea>'
  )
}

describe('wrapSoap', () => {
  it('wraps the payload in a SOAP 1.1 envelope', () => {
    const out = wrapSoap('<?xml version="1.0" encoding="UTF-8"?><Doc/>')
    expect(out).toContain(`xmlns:soapenv="${SOAP_ENV_NS}"`)
    expect(out).toContain('<soapenv:Body><Doc/></soapenv:Body>')
  })

  it('strips the payload’s XML declaration', () => {
    // A declaration is only legal at the very start of a document, so leaving the
    // payload's in place makes the envelope unparseable.
    const out = wrapSoap('<?xml version="1.0" encoding="UTF-8"?><Doc/>')
    expect(out.match(/<\?xml/g)).toHaveLength(1)
    expect(out.indexOf('<?xml')).toBe(0)
  })
})

describe('parseSubmissionReply', () => {
  it('reads the envelope verdict, the CSV and the wait time', () => {
    const r = parseSubmissionReply(
      reply(
        '<sfR:CSV>ABC123</sfR:CSV>' +
          '<sfR:TiempoEsperaEnvio>60</sfR:TiempoEsperaEnvio>' +
          '<sfR:EstadoEnvio>Correcto</sfR:EstadoEnvio>' +
          line('PLATFORM-F-2026-00001', 'Correcto'),
      ),
    )
    expect(r.estadoEnvio).toBe('Correcto')
    expect(r.csv).toBe('ABC123')
    expect(r.tiempoEsperaEnvioSeconds).toBe(60)
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0]!.numSerieFactura).toBe('PLATFORM-F-2026-00001')
  })

  it('treats AceptadoConErrores as ACCEPTED, with its error preserved', () => {
    // The outcome that matters most. AEAT HOLDS the record; the errors need a
    // later subsanación. Retrying it would resend something AEAT already has;
    // ignoring the error would hide a real defect — a mismatched huella arrives
    // exactly this way (huella spec §7).
    const r = parseSubmissionReply(
      reply(
        '<sfR:TiempoEsperaEnvio>60</sfR:TiempoEsperaEnvio>' +
          '<sfR:EstadoEnvio>ParcialmenteCorrecto</sfR:EstadoEnvio>' +
          line(
            'PLATFORM-F-2026-00001',
            'AceptadoConErrores',
            '<sfR:CodigoErrorRegistro>3002</sfR:CodigoErrorRegistro>' +
              '<sfR:DescripcionErrorRegistro>Huella incorrecta</sfR:DescripcionErrorRegistro>',
          ),
      ),
    )
    const l = r.lines[0]!
    expect(l.estado).toBe('AceptadoConErrores')
    expect(l.codigoError).toBe(3002)
    expect(l.descripcionError).toBe('Huella incorrecta')
    expect(isAccepted(l)).toBe(true)
  })

  it('treats Incorrecto as NOT accepted', () => {
    const r = parseSubmissionReply(
      reply(
        '<sfR:TiempoEsperaEnvio>60</sfR:TiempoEsperaEnvio>' +
          '<sfR:EstadoEnvio>Incorrecto</sfR:EstadoEnvio>' +
          line(
            'PLATFORM-F-2026-00001',
            'Incorrecto',
            '<sfR:CodigoErrorRegistro>1100</sfR:CodigoErrorRegistro>',
          ),
      ),
    )
    expect(isAccepted(r.lines[0]!)).toBe(false)
  })

  it('treats a duplicate as accepted — that is the idempotency signal', () => {
    // Re-sending after a lost reply must not fail. AEAT says it already holds it,
    // which is success from our side.
    const r = parseSubmissionReply(
      reply(
        '<sfR:TiempoEsperaEnvio>60</sfR:TiempoEsperaEnvio>' +
          '<sfR:EstadoEnvio>Correcto</sfR:EstadoEnvio>' +
          line(
            'PLATFORM-F-2026-00001',
            'Incorrecto',
            '<sfR:RegistroDuplicado>S</sfR:RegistroDuplicado>',
          ),
      ),
    )
    expect(r.lines[0]!.duplicado).toBe(true)
    expect(isAccepted(r.lines[0]!)).toBe(true)
  })

  it('reads several lines and keeps them identified by invoice number', () => {
    const r = parseSubmissionReply(
      reply(
        '<sfR:TiempoEsperaEnvio>60</sfR:TiempoEsperaEnvio>' +
          '<sfR:EstadoEnvio>ParcialmenteCorrecto</sfR:EstadoEnvio>' +
          line('A-1', 'Correcto') +
          line('A-2', 'Incorrecto'),
      ),
    )
    expect(r.lines.map((l) => [l.numSerieFactura, l.estado])).toEqual([
      ['A-1', 'Correcto'],
      ['A-2', 'Incorrecto'],
    ])
  })

  it('raises a SOAP Fault as an error, with its code', () => {
    // This is how 4112 arrives — a verdict on the whole envío, before any
    // per-record line exists. faultcode/faultstring are UNQUALIFIED in SOAP 1.1,
    // so a namespaced lookup would miss them and report a parse error instead of
    // a rejection.
    const xml =
      `<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}"><soapenv:Body><soapenv:Fault>` +
      '<faultcode>env:Client</faultcode>' +
      '<faultstring>4112 El titular del certificado debe ser Obligado Emision, Colaborador Social, Apoderado o Sucesor</faultstring>' +
      '</soapenv:Fault></soapenv:Body></soapenv:Envelope>'
    try {
      parseSubmissionReply(xml)
      throw new Error('expected a throw')
    } catch (e) {
      expect(e).toBeInstanceOf(SoapFaultError)
      expect((e as SoapFaultError).faultCode).toBe('env:Client')
      expect((e as SoapFaultError).message).toContain('4112')
    }
  })

  it('refuses a reply it cannot read rather than assuming success', () => {
    // Marking records sent on an unreadable response would lose them silently.
    expect(() => parseSubmissionReply('not xml at all')).toThrow(MalformedReplyError)
    expect(() => parseSubmissionReply(reply('<sfR:EstadoEnvio>Maybe</sfR:EstadoEnvio>'))).toThrow(
      MalformedReplyError,
    )
    expect(() =>
      parseSubmissionReply(
        `<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}"><soapenv:Body/></soapenv:Envelope>`,
      ),
    ).toThrow(MalformedReplyError)
  })

  it('refuses a line with an unknown EstadoRegistro', () => {
    expect(() =>
      parseSubmissionReply(
        reply(
          '<sfR:TiempoEsperaEnvio>60</sfR:TiempoEsperaEnvio>' +
            '<sfR:EstadoEnvio>Correcto</sfR:EstadoEnvio>' +
            line('A-1', 'Perfecto'),
        ),
      ),
    ).toThrow(MalformedReplyError)
  })
})
