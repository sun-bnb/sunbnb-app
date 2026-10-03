import { describe, it, expect } from 'vitest'
import {
  mayIssueInvoicesFor,
  maySubmitRecordsFor,
  grantState,
  describeGrantState,
  VERIFACTU_GRANT_TERMS_VERSION,
} from './grants'

const NONE = {
  invoicingAuthorityGrantedAt: null,
  aeatSubmissionGrantedAt: null,
  verifactuGrantTermsVersion: null,
}

describe('partner grants', () => {
  it('treats the two authorisations as separate acts', () => {
    // They rest on different provisions and gate different things, so a single
    // "agreed to Veri*factu" flag would misstate what was agreed.
    const invoicingOnly = { ...NONE, invoicingAuthorityGrantedAt: new Date() }
    expect(mayIssueInvoicesFor(invoicingOnly)).toBe(true)
    expect(maySubmitRecordsFor(invoicingOnly)).toBe(false)

    const submissionOnly = { ...NONE, aeatSubmissionGrantedAt: new Date() }
    expect(mayIssueInvoicesFor(submissionOnly)).toBe(false)
    expect(maySubmitRecordsFor(submissionOnly)).toBe(true)
  })

  it('defaults to NOT granted', () => {
    // Null means no mandate. The safe reading, and the one every existing row has.
    expect(grantState(NONE)).toBe('none')
    expect(mayIssueInvoicesFor(NONE)).toBe(false)
    expect(maySubmitRecordsFor(NONE)).toBe(false)
  })

  it('names the half-granted state rather than rounding it to yes or no', () => {
    const state = grantState({ ...NONE, invoicingAuthorityGrantedAt: new Date() })
    expect(state).toBe('invoicing-only')
    expect(describeGrantState(state)).toContain('generated and queued, not sent')
  })

  it('says plainly what no authorisation means', () => {
    // We are ALREADY issuing in their name, so "none" is not a neutral state —
    // it is an unsupported mandate, and the operator should read it that way.
    expect(describeGrantState('none')).toContain('without a recorded mandate')
    expect(describeGrantState('none')).toContain('art. 5')
  })

  it('records which wording was accepted', () => {
    // A later rewording must not retroactively claim a partner agreed to text
    // they never saw.
    expect(VERIFACTU_GRANT_TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
