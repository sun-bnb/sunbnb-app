/**
 * Print the configured AEAT certificate's metadata and prove Node can load it.
 *
 * Called by `aeat-cert.sh status` with the pair already in the environment.
 * Two checks, because they are two different code paths in production:
 *  - `getCertificateStatus` (node-forge) is what admin `/verifactu` displays;
 *  - `tls.createSecureContext` is what `https.Agent` in the AEAT client does.
 *    OpenSSL 3 refuses legacy RC2-encrypted PKCS#12 files there while forge
 *    reads them fine — so a certificate can look valid on the page and still
 *    fail every submission at the TLS layer.
 *
 * Prints metadata only — never the key or the passphrase.
 */
import tls from 'node:tls'
import {
  getCertificateStatus,
  describeCertificateStatus,
} from '../src/tax/es-verifactu/certificate'

const status = getCertificateStatus()
if (!status.configured) {
  console.error('No AEAT_CERT_PFX_BASE64 in the environment.')
  process.exit(1)
}

console.log(describeCertificateStatus(status))
if (status.subject) console.log(`Subject: ${status.subject}`)
if (status.issuer) console.log(`Issuer:  ${status.issuer}`)
if (status.validUntil) console.log(`Valid until: ${status.validUntil.toISOString().slice(0, 10)}`)

let nodeOk = false
try {
  tls.createSecureContext({
    pfx: Buffer.from(process.env.AEAT_CERT_PFX_BASE64!, 'base64'),
    passphrase: process.env.AEAT_CERT_PASSWORD,
  })
  nodeOk = true
  console.log(`Node TLS (${process.versions.openssl}): loads — the AEAT client can use it`)
} catch (err) {
  // The message is OpenSSL's ("mac verify failure", "unsupported"), never a secret.
  console.error(`Node TLS (${process.versions.openssl}): FAILS — ${(err as Error).message}`)
}

process.exit(status.error || status.expired || !nodeOk ? 1 : 0)
