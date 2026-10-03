import { describe, it, expect } from 'vitest'
import {
  buildDeclaracionResponsable,
  declaracionSignatureFromEnv,
} from './declaracion-responsable'
import { sistemaInformatico } from './sistema-informatico'

describe('the declaración responsable', () => {
  it('states exactly what the filed records state', () => {
    // The invariant this module exists to protect. Every one of these also
    // travels inside the SistemaInformatico block of every record we send, so a
    // declaration that disagrees is a false statement about the software in use.
    const si = sistemaInformatico({ VERIFACTU_SYSTEM_VERSION: '1.2.3' })
    const d = buildDeclaracionResponsable(null, si)

    expect(d.nombreSistema).toBe(si.nombreSistemaInformatico) // §1.a
    expect(d.codigoSistema).toBe(si.idSistemaInformatico) // §1.b
    expect(d.version).toBe(si.version) // §1.c
    expect(d.soloVerifactu).toBe(si.tipoUsoPosibleSoloVerifactu) // §1.e
    expect(d.multiObligado).toBe(si.tipoUsoPosibleMultiOT) // §1.f
    expect(d.razonSocialProductora).toBe(si.nombreRazon) // §1.h
    expect(d.nifProductora).toBe(si.nif) // §1.i
  })

  it('tracks the running version rather than a written-down one', () => {
    // The obligation is a declaration per VERSION. A hardcoded version would be
    // wrong on the next deploy and nobody would notice.
    const a = buildDeclaracionResponsable(null, sistemaInformatico({ VERIFACTU_SYSTEM_VERSION: '1.0.0' }))
    const b = buildDeclaracionResponsable(null, sistemaInformatico({ VERIFACTU_SYSTEM_VERSION: '2.0.0' }))
    expect(a.version).toBe('1.0.0')
    expect(b.version).toBe('2.0.0')
  })

  it('declares VERI*FACTU-only and multi-taxpayer, matching what we built', () => {
    const d = buildDeclaracionResponsable()
    // There is no NO VERI*FACTU mode in this codebase — no XAdES signing, no
    // local conservation, no event log — so `N` would claim a capability we do
    // not have and invite AEAT to expect an event log.
    expect(d.soloVerifactu).toBe('S')
    // It is a multi-tenant SaaS platform.
    expect(d.multiObligado).toBe('S')
  })

  it('explains the absence of record signatures rather than omitting it', () => {
    // §1.g would otherwise read as an oversight.
    const d = buildDeclaracionResponsable()
    expect(d.tiposFirma).toContain('VERI*FACTU')
    expect(d.tiposFirma).toContain('certificado electrónico cualificado')
  })

  it('carries AEAT’s compliance wording with the statutes it is made under', () => {
    const d = buildDeclaracionResponsable()
    expect(d.declaracionCumplimiento).toContain('artículo 29.2.j) de la Ley 58/2003')
    expect(d.declaracionCumplimiento).toContain('Real Decreto 1007/2023')
    expect(d.declaracionCumplimiento).toContain('Orden HAC/1177/2024')
  })

  it('is UNSIGNED until somebody signs it', () => {
    // An unsigned declaration is not a declaration. The renderer has to say so
    // rather than present it as one — the same class of false claim this phase
    // exists to remove.
    expect(buildDeclaracionResponsable().firma).toBeNull()
    expect(declaracionSignatureFromEnv({})).toBeNull()
    expect(declaracionSignatureFromEnv({ VERIFACTU_DECLARATION_SIGNED_ON: '2026-10-03' })).toBeNull()
  })

  it('reads a complete signature from the environment', () => {
    expect(
      declaracionSignatureFromEnv({
        VERIFACTU_DECLARATION_SIGNED_ON: '2026-10-03',
        VERIFACTU_DECLARATION_SIGNED_AT: 'Fuengirola (Málaga)',
      }),
    ).toEqual({ signedOn: '2026-10-03', signedAt: 'Fuengirola (Málaga)' })
  })

  it('has every section AEAT’s template requires', () => {
    const d = buildDeclaracionResponsable()
    // 1.a through 1.l, plus the annex 2.a–2.c.
    expect(d.descripcion.length).toBeGreaterThan(0) // §1.d
    expect(d.direccionProductora.length).toBeGreaterThan(0) // §1.j
    expect(d.contacto.length).toBeGreaterThan(0) // §2.a
    expect(d.internet.length).toBeGreaterThan(0) // §2.b
    expect(d.especificaciones.length).toBeGreaterThan(0) // §2.c
  })
})
