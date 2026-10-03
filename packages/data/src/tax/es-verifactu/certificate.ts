/**
 * What certificate are we actually filing with, and when does it die?
 * (track 026 P9)
 *
 * ## Why this is read from the certificate, not from a setting
 *
 * The FNMT representative certificate is valid **two years and cannot be renewed
 * once it has expired** — a lapse means starting the whole acquisition over,
 * including the in-person appointment. Meanwhile the sweep would fail at the TLS
 * handshake, which looks like a network fault, and records would queue up
 * silently behind a backoff.
 *
 * An operator-entered expiry date would be exactly as wrong as the day someone
 * mistyped it. So the date is parsed out of the certificate the client is
 * actually configured with.
 *
 * ## What it deliberately does not return
 *
 * Metadata only: subject, issuer, validity, days remaining. Never the key,
 * never the passphrase, never the raw bytes. This is read by an admin page, and
 * a page that can print a private key is one XSS away from losing the company's
 * signing identity.
 */

import forge from 'node-forge'

export interface CertificateStatus {
  configured: boolean
  /** Subject CN — who the certificate says we are. */
  subject?: string
  /** Issuing CA. For us this should be an FNMT `AC Representación`. */
  issuer?: string
  validFrom?: Date
  validUntil?: Date
  daysRemaining?: number
  /** True inside the window where action is still comfortably possible. */
  expiringSoon?: boolean
  expired?: boolean
  /** Set when the certificate could not be read at all. */
  error?: string
}

/**
 * Start warning this far out.
 *
 * 60 days because replacing it is not a purchase — it needs an appointment at a
 * tax office, whose lead time is the variable we cannot control. Warning at two
 * weeks would be warning too late.
 */
export const CERT_EXPIRY_WARNING_DAYS = 60

/**
 * forge returns attribute values as BINARY strings — one character per byte — so
 * anything non-ASCII arrives as mojibake. Our own producer name is "Sunbnb
 * España SL", so this is not a hypothetical: without the decode the ops page
 * renders the company's name wrongly, which is a poor look on the one screen
 * that exists to prove we know what we are filing with.
 */
function utf8(value: unknown): string {
  if (typeof value !== 'string') return ''
  try {
    return forge.util.decodeUtf8(value)
  } catch {
    // Already decodable text, or genuinely not UTF-8. Either way, don't lose it.
    return value
  }
}

function describeAttributes(attrs: forge.pki.CertificateField[]): string {
  const cn = utf8(attrs.find((a) => a.shortName === 'CN')?.value)
  const o = utf8(attrs.find((a) => a.shortName === 'O')?.value)
  return [cn, o].filter(Boolean).join(' · ') || '(unnamed)'
}

/**
 * Read the configured certificate's metadata.
 *
 * Returns `configured: false` rather than throwing when none is set — that is
 * the normal state in development and in CI, where the client runs in stub mode.
 */
export function getCertificateStatus(
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): CertificateStatus {
  const pfxBase64 = env.AEAT_CERT_PFX_BASE64
  if (!pfxBase64) return { configured: false }

  try {
    const der = forge.util.decode64(pfxBase64)
    const asn1 = forge.asn1.fromDer(der)
    // The passphrase is used here and nowhere else; it never leaves this scope.
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, env.AEAT_CERT_PASSWORD ?? '')
    // `oids.certBag` is typed as possibly undefined, and it is also the key the
    // result is indexed by — so it is read once and guarded rather than used twice.
    const certBagOid = forge.pki.oids.certBag
    if (!certBagOid) return { configured: true, error: 'node-forge has no certBag OID' }
    const certBags = p12.getBags({ bagType: certBagOid })[certBagOid]
    const cert = certBags?.[0]?.cert
    if (!cert) return { configured: true, error: 'No certificate found inside the PKCS#12 file' }

    const validUntil = cert.validity.notAfter
    const daysRemaining = Math.floor((validUntil.getTime() - now.getTime()) / 86_400_000)

    return {
      configured: true,
      subject: describeAttributes(cert.subject.attributes),
      issuer: describeAttributes(cert.issuer.attributes),
      validFrom: cert.validity.notBefore,
      validUntil,
      daysRemaining,
      expired: daysRemaining < 0,
      expiringSoon: daysRemaining >= 0 && daysRemaining <= CERT_EXPIRY_WARNING_DAYS,
    }
  } catch {
    // Almost always a wrong passphrase. Deliberately NOT surfacing the
    // underlying message: forge echoes input in some errors, and this string is
    // rendered on an admin page.
    return {
      configured: true,
      error:
        'Could not read the certificate. The password is probably wrong, or the file is not a ' +
        'PKCS#12 bundle.',
    }
  }
}

/** One line for a dashboard or a log. */
export function describeCertificateStatus(status: CertificateStatus): string {
  if (!status.configured) {
    return 'No AEAT certificate configured — the client runs in stub mode and files nothing.'
  }
  if (status.error) return `AEAT certificate unreadable: ${status.error}`
  if (status.expired) {
    return `AEAT certificate EXPIRED ${Math.abs(status.daysRemaining ?? 0)} day(s) ago. Submission is failing and cannot be fixed by retrying — FNMT certificates cannot be renewed after expiry.`
  }
  if (status.expiringSoon) {
    return `AEAT certificate expires in ${status.daysRemaining} day(s) (${status.validUntil?.toISOString().slice(0, 10)}). Replacing it needs an appointment — start now.`
  }
  return `AEAT certificate valid until ${status.validUntil?.toISOString().slice(0, 10)} (${status.daysRemaining} days).`
}
