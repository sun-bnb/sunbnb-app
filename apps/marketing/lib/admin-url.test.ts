import { describe, expect, it } from 'vitest'
import { adminUrlFor } from './admin-url.ts'

describe('adminUrlFor — the team email links to the lead in the same environment', () => {
  it('maps each marketing host to its admin app', () => {
    expect(adminUrlFor('try.sunbnb.app')).toBe('https://admin.sunbnb.app')
    expect(adminUrlFor('trytest.sunbnb.app')).toBe('https://admintest.sunbnb.app')
    expect(adminUrlFor('local.sunbnb.app:3004')).toBe('https://local.sunbnb.app:3003')
  })
  it('gives no link for an unknown host (a preview URL) rather than a wrong one', () => {
    expect(adminUrlFor('sunbnb-app-marketing-abc.vercel.app')).toBeNull()
  })
})
