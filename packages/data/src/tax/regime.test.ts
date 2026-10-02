import { describe, it, expect } from 'vitest'
import {
  ES_PROVINCES,
  isKnownEsRegion,
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

describe('an unrecognised region is never Veri*factu', () => {
  it('refuses a region name, an autonomous community, or a typo', () => {
    // The hole this closes: any non-empty, non-foral string used to resolve to
    // ES_VERIFACTU, so a hand-typed value would file a FORAL taxpayer's records
    // to AEAT — which ES_FORAL_UNSUPPORTED exists precisely to prevent. The field
    // is set by a human, so unknown must mean unknown.
    for (const region of ['BIZKAIA', 'Bilbao', 'PV', 'B1', 'Pais Vasco', 'XX', '48']) {
      expect(resolveTaxRegime({ country: 'ES', taxRegion: region })).toBe('NONE')
    }
  })

  it('still resolves a real province', () => {
    expect(resolveTaxRegime({ country: 'ES', taxRegion: 'MA' })).toBe('ES_VERIFACTU')
    // Case and whitespace are forgiven; the value is not.
    expect(resolveTaxRegime({ country: 'ES', taxRegion: ' ma ' })).toBe('ES_VERIFACTU')
  })

  it('names Canarias, Ceuta and Melilla as unsupported rather than IVA territory', () => {
    // IGIC and IPSI, not IVA. Treating them as common territory would build a
    // Desglose with IVA rates, and the invoice would then be refused downstream
    // for the confusing reason "not a legal Spanish rate" rather than the real
    // one. D7 is the open question.
    for (const region of ['GC', 'TF', 'CE', 'ML']) {
      expect(resolveTaxRegime({ country: 'ES', taxRegion: region })).toBe(
        'ES_INDIRECT_TAX_UNSUPPORTED',
      )
    }
  })

  it('keeps the foral territories distinct from both', () => {
    for (const region of ['VI', 'BI', 'SS', 'NA']) {
      expect(resolveTaxRegime({ country: 'ES', taxRegion: region })).toBe(
        'ES_FORAL_UNSUPPORTED',
      )
    }
  })

  it('treats an unrecognised region as needing an operator, like a blank one', () => {
    // More dangerous than blank, because it LOOKS configured.
    expect(needsTaxRegion({ country: 'ES', taxRegion: 'BIZKAIA' })).toBe(true)
    expect(needsTaxRegion({ country: 'ES', taxRegion: '' })).toBe(true)
    expect(needsTaxRegion({ country: 'ES', taxRegion: 'MA' })).toBe(false)
    expect(needsTaxRegion({ country: 'FI', taxRegion: null })).toBe(false)
  })

  it('only ES_VERIFACTU produces records', () => {
    expect(regimeRequiresRecords('ES_VERIFACTU')).toBe(true)
    expect(regimeRequiresRecords('ES_FORAL_UNSUPPORTED')).toBe(false)
    expect(regimeRequiresRecords('ES_INDIRECT_TAX_UNSUPPORTED')).toBe(false)
    expect(regimeRequiresRecords('NONE')).toBe(false)
  })
})

describe('ES_PROVINCES', () => {
  it('covers the 52 provinces, with unique codes', () => {
    expect(ES_PROVINCES).toHaveLength(52)
    expect(new Set(ES_PROVINCES.map((p) => p.code)).size).toBe(52)
  })

  it('includes every special-regime territory, so none can be silently absent', () => {
    // If a foral or non-IVA code were missing from the list it would resolve to
    // NONE for the wrong reason, and adding it later would flip it to Veri*factu.
    for (const code of ['VI', 'BI', 'SS', 'NA', 'GC', 'TF', 'CE', 'ML']) {
      expect(isKnownEsRegion(code)).toBe(true)
    }
  })

  it('agrees with the resolver about what it recognises', () => {
    for (const { code } of ES_PROVINCES) {
      expect(resolveTaxRegime({ country: 'ES', taxRegion: code })).not.toBe('NONE')
    }
  })
})
