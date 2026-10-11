import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import { createTestUser, createTestPartnerAccount, createTestSite } from './test/fixtures'
import {
  ASSISTANT_UNDO_WINDOW_MS,
  appendMessages,
  createConversation,
  createProposal,
  createUpload,
  expireStaleProposals,
  getConversationForAccount,
  getProposalForAccount,
  getUploadForAccount,
  listExpiredUploads,
  markApplied,
  markFailed,
  markRejected,
  markUndone,
  markUploadDeleted,
  AERIAL_STALE_RUNNING_MS,
  claimAerialExtraction,
  failAerialExtraction,
  saveAerialDescriptor,
  setUploadGeoref,
} from './assistant'

beforeEach(async () => { await cleanDatabase() })
afterAll(async () => { await disconnectDatabase() })

async function partner() {
  const user = await createTestUser()
  await createTestPartnerAccount(user.id)
  const site = await createTestSite(user.id)
  return { accountId: user.id, siteId: site.id }
}

async function proposal(now?: Date) {
  const a = await partner()
  const convo = await createConversation({ accountId: a.accountId, siteId: a.siteId })
  const p = await createProposal({
    conversationId: convo.id, accountId: a.accountId, siteId: a.siteId,
    kind: 'site_fields', payload: { name: 'X' }, preview: { diff: [] }, actorUserId: a.accountId, now,
  })
  return { ...a, convo, p: p! }
}

describe('ownership scoping', () => {
  it('never returns another account\'s conversation, proposal or upload', async () => {
    const { accountId, siteId, convo, p } = await proposal()
    const other = await partner()
    const up = await createUpload({ accountId, siteId, blobKey: 'k', url: 'u', mime: 'application/pdf', sizeBytes: 1 })

    expect(await getConversationForAccount(convo.id, accountId)).not.toBeNull()
    expect(await getConversationForAccount(convo.id, other.accountId)).toBeNull()
    expect(await getProposalForAccount(p.id, other.accountId)).toBeNull()
    expect(await getUploadForAccount(up.id, other.accountId)).toBeNull()
    expect(await getUploadForAccount(up.id, accountId)).not.toBeNull()
  })

  it('refuses to mutate another account\'s rows', async () => {
    const { convo, p } = await proposal()
    const other = await partner()
    expect(await appendMessages(convo.id, other.accountId, [{ role: 'user', content: 'x' }])).toBeNull()
    expect(await markApplied(p.id, other.accountId, {}, {})).toBe(false)
    expect(await markRejected(p.id, other.accountId)).toBe(false)
    expect((await prisma.assistantAction.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('proposed')
  })

  it('refuses a proposal attached to a conversation of another account', async () => {
    const { convo } = await proposal()
    const other = await partner()
    const p = await createProposal({
      conversationId: convo.id, accountId: other.accountId, siteId: other.siteId,
      kind: 'site_fields', payload: {}, preview: {}, actorUserId: other.accountId,
    })
    expect(p).toBeNull()
  })
})

describe('appendMessages', () => {
  it('appends in order, accumulates usage, and keeps concurrent turns', async () => {
    const a = await partner()
    const c = await createConversation(a)
    await Promise.all([
      appendMessages(c.id, a.accountId, [{ n: 1 }], { inputTokens: 10, costEstimate: 0.5 }),
      appendMessages(c.id, a.accountId, [{ n: 2 }], { inputTokens: 5, outputTokens: 3, costEstimate: 0.25 }),
    ])
    const row = await getConversationForAccount(c.id, a.accountId)
    expect(row!.messages).toHaveLength(2)
    expect(row!.usage).toEqual({ inputTokens: 15, outputTokens: 3, costEstimate: 0.75 })
  })
})

describe('status transitions', () => {
  it('applies once: the second apply loses', async () => {
    const { accountId, p } = await proposal()
    const results = await Promise.all([
      markApplied(p.id, accountId, { before: 1 }, { ok: true }),
      markApplied(p.id, accountId, { before: 1 }, { ok: true }),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    const row = await getProposalForAccount(p.id, accountId)
    expect(row).toMatchObject({ status: 'applied', snapshot: { before: 1 }, resultSummary: { ok: true } })
    expect(row!.appliedAt).not.toBeNull()
  })

  it('does not apply a lapsed proposal even before the sweeper runs', async () => {
    const t0 = new Date('2026-10-11T10:00:00Z')
    const { accountId, p } = await proposal(t0)
    expect(await markApplied(p.id, accountId, null, null, new Date(t0.getTime() + 2 * 3600_000))).toBe(false)
  })

  it('rejects/fails only from proposed; rejected and failed are terminal', async () => {
    const r = await proposal()
    expect(await markRejected(r.p.id, r.accountId)).toBe(true)
    expect(await markRejected(r.p.id, r.accountId)).toBe(false)
    expect(await markApplied(r.p.id, r.accountId, null, null)).toBe(false)
    expect(await markFailed(r.p.id, r.accountId)).toBe(false)

    const f = await proposal()
    expect(await markFailed(f.p.id, f.accountId, { error: 'boom' })).toBe(true)
    expect(await markApplied(f.p.id, f.accountId, null, null)).toBe(false)
  })

  it('undo: only from applied and only inside the window', async () => {
    const { accountId, p } = await proposal()
    expect(await markUndone(p.id, accountId)).toBe(false) // still proposed
    const applyAt = new Date()
    await markApplied(p.id, accountId, {}, {}, applyAt)
    expect(await markUndone(p.id, accountId, new Date(applyAt.getTime() + ASSISTANT_UNDO_WINDOW_MS + 1000))).toBe(false)
    expect(await markUndone(p.id, accountId, new Date(applyAt.getTime() + 1000))).toBe(true)
    expect(await markUndone(p.id, accountId)).toBe(false)
    expect((await getProposalForAccount(p.id, accountId))!.undoneAt).not.toBeNull()
  })

  it('expireStaleProposals expires only lapsed proposed rows', async () => {
    const t0 = new Date('2026-10-11T10:00:00Z')
    const stale = await proposal(t0)
    const applied = await proposal(t0)
    await markApplied(applied.p.id, applied.accountId, null, null, new Date(t0.getTime() + 1000))
    const fresh = await proposal(new Date(t0.getTime() + 3 * 3600_000))

    expect(await expireStaleProposals(new Date(t0.getTime() + 2 * 3600_000))).toBe(1)
    expect((await getProposalForAccount(stale.p.id, stale.accountId))!.status).toBe('expired')
    expect((await getProposalForAccount(applied.p.id, applied.accountId))!.status).toBe('applied')
    expect((await getProposalForAccount(fresh.p.id, fresh.accountId))!.status).toBe('proposed')
  })
})

describe('uploads', () => {
  it('lists expired, purges idempotently, and hides purged rows from the owner', async () => {
    const a = await partner()
    const t0 = new Date('2026-10-11T10:00:00Z')
    const old = await createUpload({ ...a, blobKey: 'a', url: 'u', mime: 'image/png', sizeBytes: 5, now: t0, ttlMs: 1000 })
    await createUpload({ ...a, blobKey: 'b', url: 'u', mime: 'image/png', sizeBytes: 5, now: t0, ttlMs: 10 * 3600_000 })

    const later = new Date(t0.getTime() + 60_000)
    expect((await listExpiredUploads(later)).map((u) => u.id)).toEqual([old.id])
    expect(await markUploadDeleted(old.id, later)).toBe(true)
    expect(await markUploadDeleted(old.id, later)).toBe(false)
    expect(await listExpiredUploads(later)).toEqual([])
    expect(await getUploadForAccount(old.id, a.accountId)).toBeNull()
  })
})

describe('referential behaviour', () => {
  it('deleting a site keeps the conversation (SetNull) but removes its proposals', async () => {
    const { siteId, convo, p } = await proposal()
    await prisma.site.delete({ where: { id: siteId } })
    expect((await prisma.assistantConversation.findUniqueOrThrow({ where: { id: convo.id } })).siteId).toBeNull()
    expect(await prisma.assistantAction.findUnique({ where: { id: p.id } })).toBeNull()
  })
})

describe('aerial extraction state (S7)', () => {
  async function upload() {
    const a = await partner()
    const up = await createUpload({ accountId: a.accountId, siteId: a.siteId, blobKey: 'k', url: 'u', mime: 'image/jpeg', sizeBytes: 1 })
    return { ...a, up }
  }

  it('setUploadGeoref is account-scoped', async () => {
    const { accountId, up } = await upload()
    const other = await partner()
    const g = { kind: 'similarity', anchorPx: { x: 1, y: 2 }, anchor: { lat: 1, lng: 2 }, metersPerPx: 0.05, rotationDeg: 10 }
    expect(await setUploadGeoref(up.id, other.accountId, g)).toBe(false)
    expect(await setUploadGeoref(up.id, accountId, g)).toBe(true)
    expect((await getUploadForAccount(up.id, accountId))!.georef).toEqual(g)
  })

  it('exactly one of several concurrent claims wins (no double billing)', async () => {
    const { accountId, up } = await upload()
    const results = await Promise.all(Array.from({ length: 5 }, () => claimAerialExtraction(up.id, accountId)))
    expect(results.filter((r) => r.claimed)).toHaveLength(1)
    for (const r of results.filter((r) => !r.claimed)) expect(r).toMatchObject({ claimed: false, reason: 'busy' })
  })

  it('a foreign account cannot claim, and gets not_found', async () => {
    const { up } = await upload()
    const other = await partner()
    expect(await claimAerialExtraction(up.id, other.accountId)).toEqual({ claimed: false, state: null, reason: 'not_found' })
  })

  it('done is cached (never re-claimed); failed and stale running are re-claimable', async () => {
    const { accountId, up } = await upload()
    const t0 = new Date('2026-10-11T10:00:00Z')
    const c1 = await claimAerialExtraction(up.id, accountId, t0)
    if (!c1.claimed) throw new Error('expected claim')
    // still running, not stale
    expect((await claimAerialExtraction(up.id, accountId, new Date(t0.getTime() + 60_000))).claimed).toBe(false)
    // stale running → re-claimable
    const t1 = new Date(t0.getTime() + AERIAL_STALE_RUNNING_MS + 1000)
    const c2 = await claimAerialExtraction(up.id, accountId, t1)
    if (!c2.claimed) throw new Error('expected stale re-claim')
    // the dead first runner can no longer finish its attempt
    expect(await saveAerialDescriptor(up.id, accountId, c1.startedAt, { descriptor: { old: true } })).toBe(false)
    expect(await failAerialExtraction(up.id, accountId, c2.startedAt, 'boom')).toBe(true)
    const c3 = await claimAerialExtraction(up.id, accountId, new Date(t1.getTime() + 1000))
    if (!c3.claimed) throw new Error('expected re-claim after failure')
    expect(await saveAerialDescriptor(up.id, accountId, c3.startedAt, { descriptor: { ok: 1 }, usage: { inputTokens: 5 }, model: 'm' })).toBe(true)
    const again = await claimAerialExtraction(up.id, accountId, new Date(t1.getTime() + AERIAL_STALE_RUNNING_MS * 5))
    expect(again).toMatchObject({ claimed: false, reason: 'done', state: { status: 'done', descriptor: { ok: 1 }, usage: { inputTokens: 5 } } })
  })
})
