/** POST /api/assistant with `attachments` (track 030 S5): scoping, content blocks, storage, limits. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ chat: vi.fn() }))

vi.mock('@/app/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('next-intl/server', () => ({ getLocale: vi.fn().mockResolvedValue('en') }))
vi.mock('@repo/data/flags', () => ({ getFlagStates: vi.fn() }))
vi.mock('@repo/data/rate-limit-shared', () => ({ rateLimitShared: vi.fn() }))
vi.mock('@repo/data/email', () => ({ sendEmail: vi.fn().mockResolvedValue({}) }))
vi.mock('@repo/data/assistant', () => ({
  createConversation: vi.fn(),
  getConversationForAccount: vi.fn(),
  appendMessages: vi.fn(),
  listProposalsForConversation: vi.fn().mockResolvedValue([]),
  createProposal: vi.fn(),
  getUploadForAccount: vi.fn(),
}))
vi.mock('@repo/agent/claude-model', () => ({
  createClaudeModel: () => ({ name: 'fake', chat: (...args: unknown[]) => h.chat(...args) }),
}))
vi.mock('@/lib/assistant/uploads', async (orig) => ({ ...(await orig<typeof import('@/lib/assistant/uploads')>()), readUploadBlob: vi.fn() }))
vi.mock('mammoth', () => ({ extractRawText: vi.fn().mockResolvedValue({ value: 'Sunbed 12 EUR' }) }))

import { POST } from './route'
import { auth } from '@/app/auth'
import { getLocale } from 'next-intl/server'
import prisma from '@repo/data/PrismaCient'
import { getFlagStates } from '@repo/data/flags'
import { rateLimitShared } from '@repo/data/rate-limit-shared'
import { appendMessages, createConversation, getUploadForAccount, listProposalsForConversation } from '@repo/data/assistant'
import { readUploadBlob, DOCX_MIME } from '@/lib/assistant/uploads'

const OWNER = 'owner-1'
const SITE = 'site-1'
const saved = { ...process.env }
const post = (body: unknown) => new NextRequest('http://localhost/api/assistant', { method: 'POST', body: JSON.stringify(body) })
const upload = (over: Record<string, unknown> = {}) =>
  ({ id: 'up1', accountId: OWNER, siteId: SITE, blobKey: `assistant/${OWNER}/u/Prices.pdf`, url: 'https://b/p', mime: 'application/pdf', sizeBytes: 100, purpose: 'document', expiresAt: new Date(Date.now() + 1e9), deletedAt: null, ...over }) as never

beforeEach(() => {
  vi.resetAllMocks()
  process.env.PARTNER_ASSISTANT_ENABLED = '1'
  process.env.ANTHROPIC_API_KEY = 'k'
  vi.mocked(auth).mockResolvedValue({ user: { id: OWNER } } as never)
  vi.mocked(getLocale).mockResolvedValue('en')
  vi.mocked(listProposalsForConversation).mockResolvedValue([])
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ sudo: false } as never)
  vi.mocked(prisma.site.findUnique).mockResolvedValue({ userId: OWNER } as never)
  vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([])
  vi.mocked(getFlagStates).mockResolvedValue({ assistant: { enabled: true } } as never)
  vi.mocked(rateLimitShared).mockResolvedValue({ allowed: true, count: 1 })
  vi.mocked(createConversation).mockResolvedValue({ id: 'conv-1', siteId: SITE, accountId: OWNER, messages: [] } as never)
  vi.mocked(appendMessages).mockResolvedValue({ id: 'conv-1' } as never)
  vi.mocked(readUploadBlob).mockResolvedValue(Buffer.from('%PDF-1.4 x'))
  h.chat.mockResolvedValue({ content: 'ok', toolCalls: [], providerContent: [{ type: 'text', text: 'ok' }], timing: { firstTokenMs: 1, totalMs: 2 }, usage: { promptTokens: 900, completionTokens: 20 } })
})
afterEach(() => {
  process.env = { ...saved }
})

describe('attachments', () => {
  it('400 for malformed attachments (not an array, >5, non-string) -- spending nothing', async () => {
    for (const attachments of ['up1', ['a', 'b', 'c', 'd', 'e', 'f'], [1], ['../x']]) {
      const res = await POST(post({ siteId: SITE, message: 'read', attachments }))
      expect(res.status).toBe(400)
    }
    expect(rateLimitShared).not.toHaveBeenCalled()
  })

  it("403 when an upload is not the caller's (or another site's); nothing read, no turn spent", async () => {
    vi.mocked(getUploadForAccount).mockResolvedValue(null)
    const res = await POST(post({ siteId: SITE, message: 'read', attachments: ['theirs'] }))
    expect(res.status).toBe(403)
    expect(getUploadForAccount).toHaveBeenCalledWith('theirs', OWNER)
    expect(readUploadBlob).not.toHaveBeenCalled()
    expect(rateLimitShared).not.toHaveBeenCalled()
    expect(h.chat).not.toHaveBeenCalled()

    vi.mocked(getUploadForAccount).mockResolvedValue(upload({ siteId: 'other-site' }))
    expect((await POST(post({ siteId: SITE, message: 'read', attachments: ['up1'] }))).status).toBe(403)
  })

  it('sends a PDF as a document block on the model turn, but stores only text + attachment names', async () => {
    vi.mocked(getUploadForAccount).mockResolvedValue(upload())
    const res = await POST(post({ siteId: SITE, message: 'set up my company', attachments: ['up1'] }))
    expect(res.status).toBe(200)
    await res.text()
    const sent = h.chat.mock.calls[0]![0] as { role: string; content: string; media?: { type: string }[] }[]
    const user = sent.find((m) => m.role === 'user')!
    expect(user.media).toEqual([expect.objectContaining({ type: 'document', mediaType: 'application/pdf', title: 'Prices.pdf' })])
    const stored = vi.mocked(appendMessages).mock.calls[0]![2] as Record<string, unknown>[]
    expect(JSON.stringify(stored)).not.toContain('JVBER') // no base64 in the transcript
    expect(stored[0]).toMatchObject({ role: 'user', attachments: [{ id: 'up1', name: 'Prices.pdf', kind: 'document' }] })
    expect(stored[0]).not.toHaveProperty('media')
  })

  it('DOCX text is inlined as quoted data on the model turn only', async () => {
    vi.mocked(getUploadForAccount).mockResolvedValue(upload({ mime: DOCX_MIME, blobKey: `assistant/${OWNER}/u/menu.docx` }))
    const res = await POST(post({ siteId: SITE, message: 'extract', attachments: ['up1'] }))
    await res.text()
    const user = (h.chat.mock.calls[0]![0] as { role: string; content: string; media?: unknown }[]).find((m) => m.role === 'user')!
    expect(user.content).toContain('<attached_document name="menu.docx">')
    expect(user.content).toContain('Sunbed 12 EUR')
    expect(user.media).toBeUndefined()
    expect(JSON.stringify(vi.mocked(appendMessages).mock.calls[0]![2])).not.toContain('Sunbed 12 EUR')
  })

  it('counts an extraction job (10/day) and 429s when exhausted; plain turns are not counted', async () => {
    vi.mocked(getUploadForAccount).mockResolvedValue(upload())
    vi.mocked(rateLimitShared).mockImplementation(async (key: string) => ({ allowed: !key.includes('assistant:extract:'), count: 1 }))
    const res = await POST(post({ siteId: SITE, message: 'read', attachments: ['up1'] }))
    expect(res.status).toBe(429)
    expect(h.chat).not.toHaveBeenCalled()
    const plain = await POST(post({ siteId: SITE, message: 'hello' }))
    expect(plain.status).toBe(200)
    await plain.text()
  })

  it('usage recorded from the real prompt tokens (documents included)', async () => {
    vi.mocked(getUploadForAccount).mockResolvedValue(upload())
    await (await POST(post({ siteId: SITE, message: 'read', attachments: ['up1'] }))).text()
    expect(appendMessages).toHaveBeenCalledWith('conv-1', OWNER, expect.any(Array), { inputTokens: 900, outputTokens: 20 })
  })
})
