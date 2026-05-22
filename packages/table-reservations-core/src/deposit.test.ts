import { describe, it, expect } from 'vitest'
import { computeDepositAmount, roundMoney } from './deposit'

const base = {
  noShowPolicy: 'deposit',
  depositPerGuest: 10,
  shiftRequiresDeposit: true,
  shiftDepositMinPartySize: null,
  partySize: 4,
}

describe('computeDepositAmount', () => {
  it('charges per guest when all conditions are met', () => {
    expect(computeDepositAmount(base)).toBe(40)
  })
  it('is 0 when the policy is none', () => {
    expect(computeDepositAmount({ ...base, noShowPolicy: 'none' })).toBe(0)
  })
  it('is 0 when the shift does not require a deposit', () => {
    expect(computeDepositAmount({ ...base, shiftRequiresDeposit: false })).toBe(0)
  })
  it('is 0 when per-guest amount is missing or non-positive', () => {
    expect(computeDepositAmount({ ...base, depositPerGuest: null })).toBe(0)
    expect(computeDepositAmount({ ...base, depositPerGuest: 0 })).toBe(0)
  })
  it('respects the shift minimum party size', () => {
    expect(computeDepositAmount({ ...base, shiftDepositMinPartySize: 6, partySize: 4 })).toBe(0)
    expect(computeDepositAmount({ ...base, shiftDepositMinPartySize: 6, partySize: 6 })).toBe(60)
  })
  it('rounds to 2 decimals', () => {
    expect(computeDepositAmount({ ...base, depositPerGuest: 3.333, partySize: 3 })).toBe(10)
  })
})

describe('roundMoney', () => {
  it('rounds to cents', () => {
    expect(roundMoney(10.005)).toBe(10.01)
    expect(roundMoney(9.999)).toBe(10)
  })
})
