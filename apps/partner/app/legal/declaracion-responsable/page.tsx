import {
  buildDeclaracionResponsable,
  declaracionSignatureFromEnv,
} from '@repo/data/tax/es-verifactu/declaracion-responsable'

/**
 * The *declaración responsable* for the running build (track 026 P9a).
 *
 * RD 1007/2023 requires this to be visible INSIDE the software, for every
 * version — there is nowhere to file it and nobody to approve it. AEAT does not
 * certify or homologate invoicing software; the producer declares compliance on
 * its own responsibility. This page is that declaration.
 *
 * Rendered in Spanish because it is a Spanish legal instrument whose section
 * lettering and wording follow AEAT's published template. Translating it would
 * make it a description of a declaration rather than one.
 *
 * Every factual field is derived from `sistemaInformatico()` — the same block
 * that travels inside every record we file — so this page cannot come to say
 * something different from what AEAT receives.
 */
export const dynamic = 'force-dynamic'

export default function DeclaracionResponsablePage() {
  const signature = declaracionSignatureFromEnv()
  const d = buildDeclaracionResponsable(signature)

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-12 text-sm text-gray-700 leading-relaxed">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">
          Declaración responsable del sistema informático de facturación
        </h1>
        <p className="text-xs text-gray-400 mb-8">
          Real Decreto 1007/2023 &middot; Orden HAC/1177/2024 &middot; versión {d.version}
        </p>

        {!d.firma && (
          <section className="mb-8 bg-amber-50 border border-amber-200 rounded-lg p-5">
            <h2 className="text-base font-semibold text-gray-900 mb-2">
              Pendiente de firma
            </h2>
            <p>
              Este documento recoge el contenido de la declaración responsable de la versión
              indicada, pero <strong>todavía no ha sido suscrito</strong> por la entidad
              productora. Una declaración no firmada no surte efecto como tal.
            </p>
          </section>
        )}

        <Field letter="1.a" label="Nombre del sistema informático">
          {d.nombreSistema}
        </Field>
        <Field letter="1.b" label="Código identificador del sistema informático">
          {d.codigoSistema}
        </Field>
        <Field letter="1.c" label="Identificador completo de la versión">
          {d.version}
        </Field>
        <Field letter="1.d" label="Componentes, descripción y funcionalidades principales">
          {d.descripcion.map((p, i) => (
            <p key={i} className={i > 0 ? 'mt-2' : ''}>
              {p}
            </p>
          ))}
        </Field>
        <Field
          letter="1.e"
          label="¿Solo puede funcionar exclusivamente como «VERI*FACTU»?"
        >
          {d.soloVerifactu === 'S' ? 'S - Sí' : 'N - No'}
        </Field>
        <Field
          letter="1.f"
          label="¿Permite dar soporte a la facturación de varios obligados tributarios?"
        >
          {d.multiObligado === 'S' ? 'S - Sí' : 'N - No'}
        </Field>
        <Field letter="1.g" label="Tipos de firma utilizados para firmar los registros">
          {d.tiposFirma}
        </Field>
        <Field letter="1.h" label="Razón social de la entidad productora">
          {d.razonSocialProductora}
        </Field>
        <Field letter="1.i" label="NIF de la entidad productora">
          {d.nifProductora}
        </Field>
        <Field letter="1.j" label="Dirección postal de la entidad productora">
          {d.direccionProductora.join(' · ')}
        </Field>
        <Field letter="1.k" label="Declaración de cumplimiento">
          {d.declaracionCumplimiento}
        </Field>
        <Field letter="1.l" label="Fecha y lugar de suscripción">
          {d.firma ? (
            `${d.firma.signedOn} — ${d.firma.signedAt}`
          ) : (
            <span className="text-amber-700">Pendiente de firma.</span>
          )}
        </Field>

        <h2 className="text-lg font-bold text-gray-900 mt-10 mb-4">Anexo</h2>

        <Field letter="2.a" label="Otras formas de contacto">
          {d.contacto.map((c, i) => (
            <p key={i}>{c}</p>
          ))}
        </Field>
        <Field letter="2.b" label="Direcciones de internet">
          {d.internet.map((c, i) => (
            <p key={i}>{c}</p>
          ))}
        </Field>
        <Field letter="2.c" label="Cumplimiento de las especificaciones técnicas y funcionales">
          <ul className="list-disc list-inside space-y-1.5 text-gray-600">
            {d.especificaciones.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Field>

        <p className="text-xs text-gray-400 mt-10">
          La Agencia Tributaria no homologa ni certifica los sistemas informáticos de
          facturación. Esta declaración es una autocertificación de la entidad productora,
          conforme al Real Decreto 1007/2023.
        </p>
      </div>
    </div>
  )
}

function Field({
  letter,
  label,
  children,
}: {
  letter: string
  label: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-6">
      <h2 className="text-sm font-semibold text-gray-900 mb-1">
        <span className="text-gray-400 mr-2">{letter}</span>
        {label}
      </h2>
      <div className="text-gray-700">{children}</div>
    </section>
  )
}
