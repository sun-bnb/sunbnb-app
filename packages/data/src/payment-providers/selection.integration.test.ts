import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from '../test/setup'
import { createTestUser, createTestPartnerAccount, createTestSite, resetCounter } from '../test/fixtures'
import { syncEffectiveProvider } from './selection'

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
})
afterAll(async () => {
  await disconnectDatabase()
})

async function partner(accountOverrides: Record<string, any> = {}, siteProvider = 'mollie', sites = 2) {
  const user = await createTestUser()
  await createTestPartnerAccount(user.id, accountOverrides)
  const ids: string[] = []
  for (let i = 0; i < sites; i++) {
    ids.push((await createTestSite(user.id, { paymentProvider: siteProvider })).id)
  }
  return { user, siteIds: ids }
}
const providers = async (ids: string[]) =>
  (await prisma.site.findMany({ where: { id: { in: ids } }, select: { paymentProvider: true } })).map(
    (s) => s.paymentProvider
  )

describe('syncEffectiveProvider', () => {
  it('flips every site of the account to the ready selected provider, and no other account', async () => {
    const a = await partner({
      paymentProvider: 'stripe',
      stripeConnectAccountId: 'acct_a',
      stripeConnectChargesEnabled: true,
    })
    const b = await partner({ paymentProvider: null }, 'mollie', 1)

    const r = await syncEffectiveProvider(a.user.id)
    expect(r).toEqual({ selected: 'stripe', effective: 'stripe', changed: 2 })
    expect(await providers(a.siteIds)).toEqual(['stripe', 'stripe'])
    expect(await providers(b.siteIds)).toEqual(['mollie'])
  })

  it('is idempotent: second call changes 0', async () => {
    const a = await partner({
      paymentProvider: 'stripe',
      stripeConnectAccountId: 'acct_a',
      stripeConnectChargesEnabled: true,
    })
    await syncEffectiveProvider(a.user.id)
    const again = await syncEffectiveProvider(a.user.id)
    expect(again).toEqual({ selected: 'stripe', effective: 'stripe', changed: 0 })
  })

  it('selected provider not ready → keeps the previously effective one', async () => {
    const a = await partner({
      paymentProvider: 'stripe', // selected, not connected
      mollieAccessToken: 'tok',
      mollieOnboardingStatus: 'completed',
    })
    const r = await syncEffectiveProvider(a.user.id)
    expect(r).toEqual({ selected: 'stripe', effective: 'mollie', changed: 0 })
    expect(await providers(a.siteIds)).toEqual(['mollie', 'mollie'])
  })

  it('nothing ready → sites follow the selection', async () => {
    const a = await partner({ paymentProvider: 'viva' })
    const r = await syncEffectiveProvider(a.user.id)
    expect(r).toEqual({ selected: 'viva', effective: 'viva', changed: 2 })
  })

  it('no partner account → mollie, 0 changed', async () => {
    const user = await createTestUser()
    expect(await syncEffectiveProvider(user.id)).toEqual({ selected: 'mollie', effective: 'mollie', changed: 0 })
  })
})
