import { describe, it, expect } from 'vitest'
import {
  resolveTaxRegime,
  needsTaxRegion,
  regimeRequiresRecords,
} from './regime'

describe('resolveTaxRegime', () => {
  it('is NONE for a non-Spanish issuer', () => {
    expect(resolveTaxRegime({ country: 'FI' })).toBe('NONE')
    expect(resolveTaxRegime({ country: 'DE', taxRegion: 'BY' })).toBe('NONE')
  })

  it('is NONE when the country is unknown', () => {
    expect(resolveTaxRegime({ country: null })).toBe('NONE')
    expect(resolveTaxRegime({ country: '' })).toBe('NONE')
  })

  it('is Veri*factu for common-territory Spain', () => {
    expect(resolveTaxRegime({ country: 'ES', taxRegion: 'MA' })).toBe('ES_VERIFACTU')
    expect(resolveTaxRegime({ country: 'es', taxRegion: 'b' })).toBe('ES_VERIFACTU')
  })

  it.each([
    ['Araba', 'VI'],
    ['Bizkaia', 'BI'],
    ['Gipuzkoa', 'SS'],
    ['Navarra', 'NA'],
  ])('names %s as foral rather than filing it under Veri*factu', (_name, region) => {
    // Submitting a foral taxpayer's records to the AEAT is worse than
    // submitting none — it files with the wrong authority while looking fine.
    expect(resolveTaxRegime({ country: 'ES', taxRegion: region })).toBe('ES_FORAL_UNSUPPORTED')
  })

  it('is NONE for Spain with no region set — the safe direction', () => {
    // Not submitting has a defined remedy (file late). Submitting to the wrong
    // agency has to be unwound.
    expect(resolveTaxRegime({ country: 'ES' })).toBe('NONE')
    expect(resolveTaxRegime({ country: 'ES', taxRegion: null })).toBe('NONE')
    expect(resolveTaxRegime({ country: 'ES', taxRegion: '  ' })).toBe('NONE')
  })
})

describe('needsTaxRegion', () => {
  it('flags a Spanish issuer that has not been classified', () => {
    expect(needsTaxRegion({ country: 'ES' })).toBe(true)
    expect(needsTaxRegion({ country: 'ES', taxRegion: '' })).toBe(true)
  })

  it('does not flag one that has been', () => {
    expect(needsTaxRegion({ country: 'ES', taxRegion: 'MA' })).toBe(false)
    expect(needsTaxRegion({ country: 'ES', taxRegion: 'BI' })).toBe(false)
  })

  it('does not flag a non-Spanish issuer', () => {
    expect(needsTaxRegion({ country: 'FI' })).toBe(false)
  })
})

describe('regimeRequiresRecords', () => {
  it('is true only for the one regime that is implemented', () => {
    expect(regimeRequiresRecords('ES_VERIFACTU')).toBe(true)
    expect(regimeRequiresRecords('ES_FORAL_UNSUPPORTED')).toBe(false)
    expect(regimeRequiresRecords('NONE')).toBe(false)
  })
})
