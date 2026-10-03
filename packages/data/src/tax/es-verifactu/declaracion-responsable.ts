/**
 * The *declaración responsable* — our own statement that this software meets
 * RD 1007/2023 (track 026 P9a).
 *
 * PURE. No prisma, no network, client-safe.
 *
 * ## Why this exists at all
 *
 * **AEAT does not certify or homologate invoicing software** (D4). There is no
 * approval to obtain and no register to appear in. Instead the *producer* —
 * Sunbnb — declares, on its own responsibility, that the system complies. The
 * declaration is not filed with anyone; the obligation is that it be **visible
 * inside the software, for every version**.
 *
 * That makes this module the only thing that can make the "certified software"
 * line on the live partner legal page true — and the reason that line needed
 * rewording rather than implementing: nothing certifies us but us.
 *
 * ## The invariant worth having
 *
 * Several sections restate facts the records themselves carry: the system's
 * name, its id, the running version, whether it is VERI*FACTU-only, whether it
 * serves several taxpayers, and who produced it. A declaration that disagrees
 * with the `SistemaInformatico` block in every filed record is a false statement
 * about the software in use.
 *
 * So they are not written twice. Everything derivable is **derived from
 * `sistemaInformatico()`**, and a test asserts the two agree.
 *
 * Structure and section lettering follow AEAT's published
 * *Ejemplos de declaraciones responsables*.
 */

import { sistemaInformatico, type SistemaInformatico } from './sistema-informatico'

/** Producer postal address — §1.j. */
const PRODUCER_ADDRESS = ['Fuengirola', 'Málaga', 'España']
/** §2.a / §2.b contact details. */
const PRODUCER_EMAIL = 'hola@sunbnb.app'
const PRODUCER_WEBSITE = 'https://sunbnb.app'

export interface DeclaracionSignature {
  /** §1.l — the date the producer subscribes the declaration, `YYYY-MM-DD`. */
  signedOn: string
  /** §1.l — the place. */
  signedAt: string
}

export interface DeclaracionResponsable {
  /** §1.a */ nombreSistema: string
  /** §1.b */ codigoSistema: string
  /** §1.c */ version: string
  /** §1.d */ descripcion: string[]
  /** §1.e — `S` when the system can ONLY operate as VERI*FACTU. */
  soloVerifactu: 'S' | 'N'
  /** §1.f — `S` when it can serve several obligados tributarios. */
  multiObligado: 'S' | 'N'
  /** §1.g */ tiposFirma: string
  /** §1.h */ razonSocialProductora: string
  /** §1.i */ nifProductora: string
  /** §1.j */ direccionProductora: string[]
  /** §1.k — the compliance statement. Fixed legal wording. */
  declaracionCumplimiento: string
  /** §1.l — null until the producer actually signs it. */
  firma: DeclaracionSignature | null
  /** §2.a */ contacto: string[]
  /** §2.b */ internet: string[]
  /** §2.c */ especificaciones: string[]
}

/**
 * §1.k, verbatim from AEAT's example. Fixed text: it cites the statutes the
 * declaration is made under, so it is not ours to reword.
 */
const DECLARACION_CUMPLIMIENTO =
  'La entidad productora del sistema informático a que se refiere esta declaración responsable ' +
  'hace constar que dicho sistema informático, en la versión indicada en ella, cumple con lo ' +
  'dispuesto en el artículo 29.2.j) de la Ley 58/2003, de 17 de diciembre, General Tributaria, ' +
  'en el Reglamento que establece los requisitos que deben adoptar los sistemas y programas ' +
  'informáticos o electrónicos que soporten los procesos de facturación de empresarios y ' +
  'profesionales, y la estandarización de formatos de los registros de facturación, aprobado ' +
  'por el Real Decreto 1007/2023, de 5 de diciembre, en la Orden HAC/1177/2024, de 17 de ' +
  'octubre, y en la sede electrónica de la Agencia Estatal de Administración Tributaria para ' +
  'todo aquello que complete las especificaciones de dicha orden.'

/**
 * §1.g. We are VERI*FACTU-only, so no XAdES signature is applied to records —
 * the regulation treats them as signed by being transmitted under a qualified
 * certificate. Stated because its absence would otherwise look like an omission.
 */
const TIPOS_FIRMA =
  'Dado que se trata de un sistema que solo puede ser utilizado exclusivamente en la modalidad ' +
  'de «VERI*FACTU», no se realiza una firma electrónica expresa de los registros de ' +
  'facturación generados, ya que la normativa considera que quedan firmados al ser remitidos ' +
  'correctamente a los servicios electrónicos de la Agencia Tributaria con la debida ' +
  'autenticación mediante el adecuado certificado electrónico cualificado.'

/** §1.d — what the system is and does. */
const DESCRIPCION = [
  'Sunbnb es una plataforma de software como servicio (SaaS) alojada en la nube, accesible ' +
    'mediante navegador web, que da soporte a la reserva y venta de servicios de playa ' +
    '(alquiler de hamacas y equipamiento, restauración y consumo en mesa) y a la facturación ' +
    'derivada de dichas operaciones.',
  'No se instala software en las dependencias del usuario: la totalidad del sistema se ejecuta ' +
    'en la infraestructura del productor, y los usuarios acceden a él a través de internet. No ' +
    'existe, por tanto, una versión instalada por cliente; todos los usuarios operan sobre la ' +
    'misma versión desplegada, identificada en el apartado 1.c).',
  'Funcionalidades principales: captura de los datos de la operación, expedición de facturas y ' +
    'facturas simplificadas, generación y encadenamiento de los registros de facturación, ' +
    'inclusión del código QR tributario en la factura, remisión de los registros a la sede ' +
    'electrónica de la AEAT, y consulta y exportación de la información de facturación.',
  'El sistema gestiona de forma independiente la facturación de varios obligados tributarios, ' +
    'cumpliendo separadamente con la normativa citada en el apartado 1.k) para cada uno de ' +
    'ellos, incluyendo series de facturación y cadenas de registros independientes por obligado.',
]

/** §2.c — how specific requirements are met, beyond what is mandatory. */
const ESPECIFICACIONES = [
  'La expedición de la factura y la generación de su registro de facturación se consolidan en ' +
    'una única unidad transaccional del sistema gestor de base de datos, de modo que no puede ' +
    'existir una factura expedida sin su registro, ni un registro sin su factura.',
  'El encadenamiento de los registros de facturación de cada obligado tributario se serializa ' +
    'mediante un bloqueo explícito por obligado, garantizando que la huella de cada registro ' +
    'incorpora la del inmediatamente anterior sin posibilidad de intercalado.',
  'La huella se calcula conforme al algoritmo SHA-256 y al formato de cadena de entrada ' +
    'publicados por la AEAT, y la cadena de entrada se conserva junto al registro para permitir ' +
    'su verificación posterior.',
  'Los registros de facturación se remiten a la sede electrónica de la AEAT de forma ' +
    'asíncrona y con reintentos, respetando el orden de la cadena de cada obligado tributario.',
]

/**
 * Build the declaration for the running build.
 *
 * `signature` is null until the producer signs it. The renderer must say so
 * rather than present an unsigned document as a declaration — an unsigned
 * declaration is not one, and showing it as though it were would be the same
 * class of false claim this phase exists to remove.
 */
export function buildDeclaracionResponsable(
  signature: DeclaracionSignature | null = null,
  si: SistemaInformatico = sistemaInformatico(),
): DeclaracionResponsable {
  return {
    // Derived, never restated — see the invariant note in the module header.
    nombreSistema: si.nombreSistemaInformatico,
    codigoSistema: si.idSistemaInformatico,
    version: si.version,
    soloVerifactu: si.tipoUsoPosibleSoloVerifactu,
    multiObligado: si.tipoUsoPosibleMultiOT,
    razonSocialProductora: si.nombreRazon,
    nifProductora: si.nif,

    descripcion: DESCRIPCION,
    tiposFirma: TIPOS_FIRMA,
    direccionProductora: PRODUCER_ADDRESS,
    declaracionCumplimiento: DECLARACION_CUMPLIMIENTO,
    firma: signature,
    contacto: [`Correo electrónico: ${PRODUCER_EMAIL}`],
    internet: [
      `Sitio web: ${PRODUCER_WEBSITE}`,
      `Declaración responsable de esta versión: ${PRODUCER_WEBSITE}/legal/declaracion-responsable`,
    ],
    especificaciones: ESPECIFICACIONES,
  }
}

/**
 * Read the signature from the environment.
 *
 * Env rather than a database row for the same reason `sistemaInformatico` is
 * compiled in: the declaration describes a BUILD, and a value an operator could
 * change at runtime would let the document claim something the running code does
 * not do.
 */
export function declaracionSignatureFromEnv(
  env: Record<string, string | undefined> = process.env,
): DeclaracionSignature | null {
  const signedOn = env.VERIFACTU_DECLARATION_SIGNED_ON
  const signedAt = env.VERIFACTU_DECLARATION_SIGNED_AT
  if (!signedOn || !signedAt) return null
  return { signedOn, signedAt }
}
