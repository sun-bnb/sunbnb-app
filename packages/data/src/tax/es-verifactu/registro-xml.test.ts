import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  buildRegistroAltaXml,
  buildSubmissionXml,
  xmlEscape,
  ENDPOINTS,
  ID_VERSION,
  TIPO_HUELLA_SHA256,
  MAX_RECORDS_PER_SUBMISSION,
  type RegistroAltaXmlInput,
} from './registro-xml'
import { sistemaInformatico } from './sistema-informatico'

const SI = sistemaInformatico({ VERIFACTU_SYSTEM_VERSION: '1.0.0' })

function altaInput(over: Partial<RegistroAltaXmlInput> = {}): RegistroAltaXmlInput {
  return {
    issuerNif: 'B22435705',
    nombreRazonEmisor: 'Sunbnb España SL',
    numSerieFactura: 'PLATFORM-F-2026-00001',
    fechaExpedicion: '10-07-2026',
    tipoFactura: 'F1',
    descripcionOperacion: 'Comisión por servicios de intermediación',
    destinatarios: [{ nombreRazon: 'Alonso Beach SL', nif: 'B29806043' }],
    desglose: [
      { calificacionOperacion: 'S1', tipoImpositivo: 21, baseImponible: 100, cuotaRepercutida: 21 },
    ],
    cuotaTotal: '21.00',
    importeTotal: '121.00',
    encadenamiento: { first: true },
    sistemaInformatico: SI,
    fechaHoraHusoGenRegistro: '2026-07-10T11:30:00+02:00',
    huella: 'A'.repeat(64),
    ...over,
  }
}

/** Element names in document order, so a sequence violation is visible. */
function elementOrder(xml: string): string[] {
  return Array.from(xml.matchAll(/<(?:sf|sfLR):([A-Za-z0-9]+)(?:\s[^>]*)?>/g)).map((m) => m[1]!)
}

describe('buildRegistroAltaXml', () => {
  it('emits RegistroFacturacionAltaType elements in the schema sequence', () => {
    // Every complexType involved is an xsd:sequence, so this order is mandatory,
    // not stylistic. AEAT answers an out-of-order document with
    // "4102 = El XML no cumple el esquema", which does not say which element
    // moved — so the order is asserted here rather than discovered in production.
    const order = elementOrder(buildRegistroAltaXml(altaInput()))
    expect(order).toEqual([
      'RegistroFactura',
      'RegistroAlta',
      'IDVersion',
      'IDFactura',
      'IDEmisorFactura',
      'NumSerieFactura',
      'FechaExpedicionFactura',
      'NombreRazonEmisor',
      'TipoFactura',
      'DescripcionOperacion',
      'Destinatarios',
      'IDDestinatario',
      'NombreRazon',
      'NIF',
      'Desglose',
      'DetalleDesglose',
      'Impuesto',
      'ClaveRegimen',
      'CalificacionOperacion',
      'TipoImpositivo',
      'BaseImponibleOimporteNoSujeto',
      'CuotaRepercutida',
      'CuotaTotal',
      'ImporteTotal',
      'Encadenamiento',
      'PrimerRegistro',
      'SistemaInformatico',
      'NombreRazon',
      'NIF',
      'NombreSistemaInformatico',
      'IdSistemaInformatico',
      'Version',
      'NumeroInstalacion',
      'TipoUsoPosibleSoloVerifactu',
      'TipoUsoPosibleMultiOT',
      'IndicadorMultiplesOT',
      'FechaHoraHusoGenRegistro',
      'TipoHuella',
      'Huella',
    ])
  })

  it('pins the two enumerated values the schema allows exactly one of', () => {
    const xml = buildRegistroAltaXml(altaInput())
    expect(ID_VERSION).toBe('1.0')
    expect(TIPO_HUELLA_SHA256).toBe('01')
    expect(xml).toContain('<sf:IDVersion>1.0</sf:IDVersion>')
    expect(xml).toContain('<sf:TipoHuella>01</sf:TipoHuella>')
  })

  it('carries the SistemaInformatico flags the schema requires', () => {
    // These three were absent from our SistemaInformatico until the payload was
    // built against the XSD; without them the document is invalid.
    const xml = buildRegistroAltaXml(altaInput())
    expect(xml).toContain('<sf:TipoUsoPosibleSoloVerifactu>S</sf:TipoUsoPosibleSoloVerifactu>')
    expect(xml).toContain('<sf:TipoUsoPosibleMultiOT>S</sf:TipoUsoPosibleMultiOT>')
    expect(xml).toContain('<sf:IndicadorMultiplesOT>S</sf:IndicadorMultiplesOT>')
  })

  it('writes the amounts it was given, without reformatting them', () => {
    // The totals arrive already serialized by formatImporte, because the huella
    // hashed those exact strings. Reformatting here is how a filed document comes
    // to disagree with its own hash.
    const xml = buildRegistroAltaXml(altaInput({ cuotaTotal: '21.00', importeTotal: '121.00' }))
    expect(xml).toContain('<sf:CuotaTotal>21.00</sf:CuotaTotal>')
    expect(xml).toContain('<sf:ImporteTotal>121.00</sf:ImporteTotal>')
  })

  it('uses PrimerRegistro for the first record and RegistroAnterior after it', () => {
    expect(buildRegistroAltaXml(altaInput())).toContain('<sf:PrimerRegistro>S</sf:PrimerRegistro>')

    const chained = buildRegistroAltaXml(
      altaInput({
        encadenamiento: {
          first: false,
          previous: {
            issuerNif: 'B22435705',
            numSerieFactura: 'PLATFORM-F-2026-00001',
            fechaExpedicion: '10-07-2026',
            huella: 'B'.repeat(64),
          },
        },
      }),
    )
    expect(chained).not.toContain('PrimerRegistro')
    expect(chained).toContain('<sf:RegistroAnterior>')
    // The previous record is identified AND hashed — all four fields.
    expect(chained).toContain(`<sf:Huella>${'B'.repeat(64)}</sf:Huella>`)
  })

  it('emits TipoRectificativa and FacturasRectificadas only on an R type', () => {
    const plain = buildRegistroAltaXml(altaInput({ tipoRectificativa: 'I' }))
    // F1 is not a rectificativa, so the field must not appear even if supplied.
    expect(plain).not.toContain('TipoRectificativa')

    const rect = buildRegistroAltaXml(
      altaInput({
        tipoFactura: 'R5',
        tipoRectificativa: 'I',
        facturasRectificadas: [
          {
            issuerNif: 'B22435705',
            numSerieFactura: 'AB-F-2026-00001',
            fechaExpedicion: '01-07-2026',
          },
        ],
      }),
    )
    expect(rect).toContain('<sf:TipoRectificativa>I</sf:TipoRectificativa>')
    expect(rect).toContain('<sf:IDFacturaRectificada>')
  })

  it('omits Destinatarios on a factura simplificada', () => {
    const xml = buildRegistroAltaXml(altaInput({ tipoFactura: 'F2', destinatarios: undefined }))
    expect(xml).not.toContain('Destinatarios')
  })

  it('escapes text that would otherwise break the document', () => {
    // A company name containing "&" is the realistic case, and unescaped it makes
    // the XML unparseable rather than merely wrong.
    const xml = buildRegistroAltaXml(
      altaInput({ nombreRazonEmisor: 'Pepe & Hijos <SL> "Playa"' }),
    )
    expect(xml).toContain(
      '<sf:NombreRazonEmisor>Pepe &amp; Hijos &lt;SL&gt; &quot;Playa&quot;</sf:NombreRazonEmisor>',
    )
    expect(xmlEscape("it's")).toBe('it&apos;s')
  })

  it('declares both namespaces on the fragment so it parses standalone', () => {
    // The fragment is stored on the record and read back months later, possibly
    // to explain a rejection. One that cannot be parsed on its own is useless then.
    const xml = buildRegistroAltaXml(altaInput())
    expect(xml).toContain('xmlns:sfLR=')
    expect(xml).toContain('xmlns:sf=')
  })
})

describe('buildSubmissionXml', () => {
  it('puts Cabecera in the SuministroLR namespace and its children in SuministroInformacion', () => {
    // The subtlety that made the first generated document schema-invalid:
    // `Cabecera` is declared locally inside RegFactuSistemaFacturacion in
    // SuministroLR.xsd, so the ELEMENT is in the LR namespace even though its
    // TYPE comes from the other schema.
    const xml = buildSubmissionXml(
      { obligadoEmision: { nombreRazon: 'Sunbnb España SL', nif: 'B22435705' } },
      [buildRegistroAltaXml(altaInput())],
    )
    expect(xml).toContain('<sfLR:Cabecera>')
    expect(xml).toContain('<sf:ObligadoEmision>')
    expect(xml).not.toContain('<sf:Cabecera>')
  })

  it('omits Representante when we are the obligado ourselves', () => {
    const xml = buildSubmissionXml(
      { obligadoEmision: { nombreRazon: 'Sunbnb España SL', nif: 'B22435705' } },
      [buildRegistroAltaXml(altaInput())],
    )
    expect(xml).not.toContain('Representante')
  })

  it('includes Representante when submitting for somebody else', () => {
    const xml = buildSubmissionXml(
      {
        obligadoEmision: { nombreRazon: 'Alonso Beach SL', nif: 'B29806043' },
        representante: { nombreRazon: 'Sunbnb España SL', nif: 'B22435705' },
      },
      [buildRegistroAltaXml(altaInput())],
    )
    expect(xml).toContain('<sf:Representante>')
  })

  it('refuses an empty or oversized batch', () => {
    expect(() => buildSubmissionXml({ obligadoEmision: { nombreRazon: 'x', nif: 'y' } }, [])).toThrow()
    const many = Array.from({ length: MAX_RECORDS_PER_SUBMISSION + 1 }, () =>
      buildRegistroAltaXml(altaInput()),
    )
    expect(() =>
      buildSubmissionXml({ obligadoEmision: { nombreRazon: 'x', nif: 'y' } }, many),
    ).toThrow(/at most 1000/)
  })
})

describe('the endpoints', () => {
  it('uses the non-Sello hosts, matching the certificate we hold', () => {
    // www1/prewww1 expect a representante certificate; www10/prewww10 are the
    // ...Sello ports and expect a certificado de sello electrónico. We hold an
    // FNMT Certificado de Representante, so pointing at www10 would fail during
    // the TLS handshake and look like a network fault.
    expect(ENDPOINTS.production).toContain('www1.agenciatributaria.gob.es')
    expect(ENDPOINTS.pruebas).toContain('prewww1.aeat.es')
    expect(ENDPOINTS.productionSello).toContain('www10.')
    expect(ENDPOINTS.pruebasSello).toContain('prewww10.')
  })
})

// ─── validation against AEAT's published schema ───────────────────────────────

function xmllintAvailable(): boolean {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe('against AEAT’s published XSD', () => {
  const available = xmllintAvailable()
  const run = available ? it : it.skip
  if (!available) {
    // Loud on purpose: a silently-skipped schema check is worse than none,
    // because the suite still reports green.
    console.warn(
      '[registro-xml] xmllint not found — SKIPPING XSD validation. ' +
        'Install libxml2-utils to run it; the element-order tests above still run.',
    )
  }

  run('validates a submission carrying an F1 and a chained R5', () => {
    const doc = buildSubmissionXml(
      { obligadoEmision: { nombreRazon: 'Sunbnb España SL', nif: 'B22435705' } },
      [
        buildRegistroAltaXml(altaInput()),
        buildRegistroAltaXml(
          altaInput({
            numSerieFactura: 'PLATFORM-R-2026-00001',
            tipoFactura: 'R5',
            tipoRectificativa: 'I',
            facturasRectificadas: [
              {
                issuerNif: 'B22435705',
                numSerieFactura: 'PLATFORM-F-2026-00001',
                fechaExpedicion: '10-07-2026',
              },
            ],
            desglose: [
              {
                calificacionOperacion: 'S1',
                tipoImpositivo: 21,
                baseImponible: -100,
                cuotaRepercutida: -21,
              },
            ],
            cuotaTotal: '-21.00',
            importeTotal: '-121.00',
            encadenamiento: {
              first: false,
              previous: {
                issuerNif: 'B22435705',
                numSerieFactura: 'PLATFORM-F-2026-00001',
                fechaExpedicion: '10-07-2026',
                huella: 'B'.repeat(64),
              },
            },
          }),
        ),
      ],
    )

    const dir = mkdtempSync(join(tmpdir(), 'verifactu-xsd-'))
    const file = join(dir, 'submission.xml')
    writeFileSync(file, doc)
    const schema = resolve(__dirname, 'schemas/SuministroLR.xsd')

    // Throws with xmllint's own diagnostics on failure, which name the offending
    // element — far more useful than a boolean.
    execFileSync('xmllint', ['--noout', '--schema', schema, file], { stdio: 'pipe' })
  })

  run('rejects a document with the elements out of order', () => {
    // Proves the validation is actually discriminating, rather than passing
    // everything. Swapping CuotaTotal and ImporteTotal violates the sequence.
    const doc = buildSubmissionXml(
      { obligadoEmision: { nombreRazon: 'Sunbnb España SL', nif: 'B22435705' } },
      [buildRegistroAltaXml(altaInput())],
    ).replace(
      '<sf:CuotaTotal>21.00</sf:CuotaTotal><sf:ImporteTotal>121.00</sf:ImporteTotal>',
      '<sf:ImporteTotal>121.00</sf:ImporteTotal><sf:CuotaTotal>21.00</sf:CuotaTotal>',
    )

    const dir = mkdtempSync(join(tmpdir(), 'verifactu-xsd-bad-'))
    const file = join(dir, 'submission.xml')
    writeFileSync(file, doc)
    const schema = resolve(__dirname, 'schemas/SuministroLR.xsd')

    expect(() =>
      execFileSync('xmllint', ['--noout', '--schema', schema, file], { stdio: 'pipe' }),
    ).toThrow()
  })
})
