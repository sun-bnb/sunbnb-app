import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getCertificateStatus,
  describeCertificateStatus,
  CERT_EXPIRY_WARNING_DAYS,
} from './certificate'

/** Build a throwaway PKCS#12 so the parser is tested against a real one. */
function makePfx(days: number, password = 'testpass'): string {
  const dir = mkdtempSync(join(tmpdir(), 'verifactu-cert-'))
  const key = join(dir, 'k.pem')
  const crt = join(dir, 'c.pem')
  const p12 = join(dir, 'test.p12')
  execFileSync('openssl', [
    // `-utf8` matters: without it openssl treats the subject bytes as Latin-1 and
    // DOUBLE-encodes them, producing a certificate whose O reads
    // "Sunbnb EspaÃÂ±a SL". That is a fixture artefact, not something a real FNMT
    // certificate does — but without this flag the test would wrongly suggest the
    // production decode is broken.
    'req', '-x509', '-utf8', '-newkey', 'rsa:2048', '-keyout', key, '-out', crt,
    '-days', String(days), '-nodes', '-subj', '/C=ES/O=Sunbnb España SL/CN=TEST REPRESENTANTE',
  ], { stdio: 'pipe' })
  execFileSync('openssl', [
    'pkcs12', '-export', '-out', p12, '-inkey', key, '-in', crt, '-passout', `pass:${password}`,
  ], { stdio: 'pipe' })
  return readFileSync(p12).toString('base64')
}

describe('getCertificateStatus', () => {
  it('reports nothing configured when no certificate is set', () => {
    const s = getCertificateStatus({})
    expect(s.configured).toBe(false)
    expect(describeCertificateStatus(s)).toContain('stub mode')
  })

  it('reads subject, issuer and expiry out of a real PKCS#12', () => {
    // Parsed from the certificate rather than from a setting, because an
    // operator-entered date is exactly as wrong as the day it was mistyped.
    const s = getCertificateStatus({
      AEAT_CERT_PFX_BASE64: makePfx(730),
      AEAT_CERT_PASSWORD: 'testpass',
    })
    expect(s.configured).toBe(true)
    expect(s.error).toBeUndefined()
    expect(s.subject).toContain('TEST REPRESENTANTE')
    // Our own producer name carries an "ñ". forge hands back attribute values as
    // BINARY strings, so without a UTF-8 decode the ops page would render the
    // company's name as mojibake on the one screen meant to prove we know what we
    // are filing with.
    expect(s.subject).toContain('Sunbnb España SL')
    expect(s.daysRemaining).toBeGreaterThan(700)
    expect(s.expired).toBe(false)
    expect(s.expiringSoon).toBe(false)
  })

  it('warns well before expiry, not at the last minute', () => {
    // Replacing it needs an appointment at a tax office, whose lead time we do
    // not control — so the warning window is measured in months.
    const s = getCertificateStatus({
      AEAT_CERT_PFX_BASE64: makePfx(730),
      AEAT_CERT_PASSWORD: 'testpass',
      // 700 days in, so 30 remain.
    }, new Date(Date.now() + 700 * 86_400_000))
    expect(s.daysRemaining).toBeLessThanOrEqual(CERT_EXPIRY_WARNING_DAYS)
    expect(s.expiringSoon).toBe(true)
    expect(describeCertificateStatus(s)).toContain('start now')
  })

  it('reports an expired certificate as unfixable by retrying', () => {
    const s = getCertificateStatus({
      AEAT_CERT_PFX_BASE64: makePfx(730),
      AEAT_CERT_PASSWORD: 'testpass',
    }, new Date(Date.now() + 800 * 86_400_000))
    expect(s.expired).toBe(true)
    // The operationally important part: an expired FNMT certificate cannot be
    // renewed, so this is not a wait-and-retry situation.
    expect(describeCertificateStatus(s)).toContain('cannot be renewed')
  })

  it('reports a wrong password without echoing anything back', () => {
    const s = getCertificateStatus({
      AEAT_CERT_PFX_BASE64: makePfx(730, 'correct'),
      AEAT_CERT_PASSWORD: 'wrong',
    })
    expect(s.configured).toBe(true)
    expect(s.error).toContain('password is probably wrong')
    // This string is rendered on an admin page, so it must not echo the
    // passphrase that was tried — forge includes input in some of its messages.
    expect(s.error).not.toContain('correct')
    expect(s.error).not.toContain('MII') // no base64 of the bundle either
  })
})
