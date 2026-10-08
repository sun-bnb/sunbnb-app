import { describe, expect, it } from 'vitest'
import { currentStep, dueRequirements, requirementLabelKey, requirementGroup, stepForRequirement } from './steps'

const col = (due: string[] = [], id: string | null = 'acct_1') => ({
  stripeConnectAccountId: id,
  stripeConnectRequirementsDue: due,
})

describe('currentStep', () => {
  it('no account -> business-type', () => {
    expect(currentStep(col([], null))).toBe('business-type')
  })
  it('details missing wins over bank and terms', () => {
    expect(currentStep(col(['company.name', 'external_account', 'tos_acceptance.date']))).toBe('details')
  })
  it('details done, external_account due -> bank', () => {
    expect(currentStep(col(['external_account', 'tos_acceptance.date']))).toBe('bank')
  })
  it('only tos_acceptance due -> terms', () => {
    expect(currentStep(col(['tos_acceptance.date', 'tos_acceptance.ip']))).toBe('terms')
  })
  it('nothing due -> status', () => {
    expect(currentStep(col([]))).toBe('status')
  })
  it('restricted with verification document -> status, requirement listed', () => {
    const snap = { currentlyDue: ['individual.verification.document'], pastDue: [] }
    expect(currentStep(col([]), snap)).toBe('status')
    expect(dueRequirements(col([]), snap)).toContain('individual.verification.document')
  })
  it('snapshot overrides stale columns', () => {
    expect(currentStep(col(['external_account']), { currentlyDue: [] })).toBe('status')
  })
})

describe('requirementLabelKey', () => {
  it('maps common keys', () => {
    expect(requirementLabelKey('external_account')).toBe('reqExternalAccount')
    expect(requirementLabelKey('individual.verification.document')).toBe('reqDocument')
    expect(requirementLabelKey('representative.dob.day')).toBe('reqRepresentative')
    expect(requirementLabelKey('company.tax_id')).toBe('reqTaxId')
    expect(requirementGroup('tos_acceptance.date')).toBe('terms')
  })
  it('maps owners, phone, nationality, title, mcc and url requirements', () => {
    expect(requirementLabelKey('company.owners_provided')).toBe('reqOwners')
    expect(requirementLabelKey('owners.first_name')).toBe('reqOwners')
    expect(requirementLabelKey('representative.nationality')).toBe('reqNationality')
    expect(requirementLabelKey('individual.phone')).toBe('reqPhone')
    expect(requirementLabelKey('company.phone')).toBe('reqPhone')
    expect(requirementLabelKey('representative.relationship.title')).toBe('reqJobTitle')
    expect(requirementLabelKey('business_profile.mcc')).toBe('reqMcc')
    expect(requirementLabelKey('business_profile.url')).toBe('reqUrl')
    expect(requirementLabelKey('business_profile.product_description')).toBe('reqBusinessProfile')
  })
  it('routes new details requirements to the details step', () => {
    for (const k of ['company.owners_provided', 'owners.dob.day', 'representative.relationship.title', 'individual.nationality', 'business_profile.url']) {
      expect(stepForRequirement(k)).toBe('details')
    }
    expect(currentStep(col(['owners.email', 'external_account']))).toBe('details')
  })
  it('returns null for unknown keys', () => {
    expect(requirementLabelKey('foo.bar')).toBeNull()
  })
})
