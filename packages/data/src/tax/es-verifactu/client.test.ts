import { describe, it, expect } from 'vitest'
import {
  createAeatHttpClient,
  getAeatClient,
  resolveAeatMode,
  aeatEnvironmentMismatch,
  AeatCertificateMissingError,
  AeatEnvironmentMismatchError,
} from './client'

const CERT = Buffer.from('not-a-real-pfx').toString('base64')
const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv

describe('the transmission switch', () => {
  it('is OFF with no certificate — never the stub', () => {
    // The stub accepts everything; resolving to it in a real environment marked
    // real records `sent` while AEAT held nothing.
    expect(resolveAeatMode(env({}))).toBe('off')
    expect(getAeatClient(env({}))).toBeNull()
  })

  it('reads the legacy AEAT_MODE=stub as off, even with a certificate', () => {
    expect(resolveAeatMode(env({ AEAT_MODE: 'stub', AEAT_CERT_PFX_BASE64: CERT }))).toBe('off')
    expect(getAeatClient(env({ AEAT_MODE: 'stub', AEAT_CERT_PFX_BASE64: CERT }))).toBeNull()
    expect(getAeatClient(env({ AEAT_MODE: 'off', AEAT_CERT_PFX_BASE64: CERT }))).toBeNull()
  })

  it('uses the real client when a certificate is present', () => {
    expect(getAeatClient(env({ AEAT_CERT_PFX_BASE64: CERT }))?.mode).toBe('http')
  })

  it('FAILS CLOSED in explicit http mode with no certificate', () => {
    expect(() => createAeatHttpClient(env({ AEAT_MODE: 'http' }))).toThrow(
      AeatCertificateMissingError,
    )
    expect(() => getAeatClient(env({ AEAT_MODE: 'http' }))).toThrow(AeatCertificateMissingError)
  })
})

describe('the AEAT environment must match the deployment', () => {
  it('defaults to pruebas off production', () => {
    const c = getAeatClient(env({ AEAT_CERT_PFX_BASE64: CERT }))
    expect(c?.environment).toBe('pruebas')
    expect(c?.endpoint).toContain('prewww1.aeat.es')
  })

  it('refuses AEAT production from anywhere but a production deployment', () => {
    // A laptop (no VERCEL_ENV) and a branch preview are both refused.
    for (const vercelEnv of [undefined, 'preview', 'development']) {
      const e = env({
        AEAT_CERT_PFX_BASE64: CERT,
        AEAT_ENV: 'production',
        ...(vercelEnv ? { VERCEL_ENV: vercelEnv } : {}),
      })
      expect(aeatEnvironmentMismatch(e)).toMatch(/only accepted on a Vercel production/)
      expect(() => getAeatClient(e)).toThrow(AeatEnvironmentMismatchError)
    }
  })

  it('refuses a production deployment that is not set to AEAT production', () => {
    // A forgotten AEAT_ENV would otherwise file real invoices to preproducción.
    for (const aeatEnv of [undefined, 'pruebas', 'prod']) {
      const e = env({
        AEAT_CERT_PFX_BASE64: CERT,
        VERCEL_ENV: 'production',
        ...(aeatEnv ? { AEAT_ENV: aeatEnv } : {}),
      })
      expect(aeatEnvironmentMismatch(e)).toMatch(/production deployment/)
      expect(() => getAeatClient(e)).toThrow(AeatEnvironmentMismatchError)
    }
  })

  it('accepts AEAT production on a production deployment, on the non-Sello host', () => {
    const c = getAeatClient(
      env({ AEAT_CERT_PFX_BASE64: CERT, VERCEL_ENV: 'production', AEAT_ENV: 'production' }),
    )
    expect(c?.environment).toBe('production')
    expect(c?.endpoint).toContain('www1.agenciatributaria.gob.es')
    // Not the ...Sello port: we hold a representative certificate.
    expect(c?.endpoint).not.toContain('www10')
  })

  it('does not block a paused production deployment', () => {
    // Production with no certificate is the normal pre-go-live state: off, no throw.
    expect(getAeatClient(env({ VERCEL_ENV: 'production' }))).toBeNull()
  })
})
