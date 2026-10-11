/**
 * Partner AI assistant persistence (track 030).
 *
 * Server-side only. Every reader and writer is ACCOUNT-SCOPED: an id alone never selects a row, the
 * owning `accountId` (the partner's user id) is always part of the predicate, so a leaked/guessed id
 * from another account behaves exactly like a missing row (null / false). Status transitions are
 * enforced both by the pure guard (`canTransition`) and by a compare-and-set in the UPDATE itself, so
 * two racing requests cannot both apply the same proposal.
 *
 * Import as `@repo/data/assistant`.
 */
import { Prisma } from '@prisma/client'
import prisma from '../index'

// ─── Status constants + transition guard (pure) ─────────────────────────────

export const ASSISTANT_ACTION_STATUS = {
  PROPOSED: 'proposed',
  APPLIED: 'applied',
  REJECTED: 'rejected',
  UNDONE: 'undone',
  EXPIRED: 'expired',
  FAILED: 'failed',
} as const

export type AssistantActionStatus =
  (typeof ASSISTANT_ACTION_STATUS)[keyof typeof ASSISTANT_ACTION_STATUS]

export const ASSISTANT_ACTION_STATUSES: readonly AssistantActionStatus[] =
  Object.values(ASSISTANT_ACTION_STATUS)

const S = ASSISTANT_ACTION_STATUS

/** proposed → applied|rejected|expired|failed ; applied → undone ; everything else is terminal. */
const TRANSITIONS: Record<AssistantActionStatus, readonly AssistantActionStatus[]> = {
  [S.PROPOSED]: [S.APPLIED, S.REJECTED, S.EXPIRED, S.FAILED],
  [S.APPLIED]: [S.UNDONE],
  [S.REJECTED]: [],
  [S.UNDONE]: [],
  [S.EXPIRED]: [],
  [S.FAILED]: [],
}

export function canTransition(from: string, to: string): boolean {
  return (TRANSITIONS[from as AssistantActionStatus] ?? []).includes(to as AssistantActionStatus)
}

/** Snapshot undo is offered for 24 h after apply (D10). */
export const ASSISTANT_UNDO_WINDOW_MS = 24 * 60 * 60 * 1000
/** A proposal not applied within this window expires (D2). */
export const ASSISTANT_PROPOSAL_TTL_MS = 60 * 60 * 1000
/** Uploads are purged 30 days after upload (D8); callers may shorten once the proposal resolves. */
export const ASSISTANT_UPLOAD_TTL_MS = 30 * 24 * 60 * 60 * 1000

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AssistantUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  /** Running cost estimate (EUR), recorded from usage — the daily-budget input (D7). */
  costEstimate?: number
}

const USAGE_KEYS = [
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'costEstimate',
] as const

/** Pure: add a usage delta to running totals (missing fields count as 0). */
export function addUsage(
  current: AssistantUsage | null | undefined,
  delta: AssistantUsage | null | undefined,
): AssistantUsage {
  const out: AssistantUsage = {}
  for (const k of USAGE_KEYS) {
    const v = (current?.[k] ?? 0) + (delta?.[k] ?? 0)
    if (v !== 0 || current?.[k] !== undefined || delta?.[k] !== undefined) out[k] = v
  }
  return out
}

type Json = Prisma.InputJsonValue

// ─── Conversations ──────────────────────────────────────────────────────────

export async function createConversation(input: {
  accountId: string
  siteId?: string | null
  title?: string | null
  consentVersion?: string | null
}) {
  return prisma.assistantConversation.create({
    data: {
      accountId: input.accountId,
      siteId: input.siteId ?? null,
      title: input.title ?? null,
      consentVersion: input.consentVersion ?? null,
      messages: [],
    },
  })
}

/** The conversation, or null when it does not exist OR belongs to another account. */
export async function getConversationForAccount(id: string, accountId: string) {
  return prisma.assistantConversation.findFirst({ where: { id, accountId } })
}

/**
 * Append to the transcript (never rewrites earlier entries) and add the usage delta. Row-locked so
 * two concurrent turns cannot lose each other's messages. Returns null when not owned.
 */
export async function appendMessages(
  id: string,
  accountId: string,
  messages: Json[],
  usageDelta?: AssistantUsage,
) {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM assistant_conversation WHERE id = ${id} AND account_id = ${accountId} FOR UPDATE`
    if (locked.length === 0) return null
    const row = await tx.assistantConversation.findUniqueOrThrow({ where: { id } })
    const prior = Array.isArray(row.messages) ? (row.messages as Json[]) : []
    return tx.assistantConversation.update({
      where: { id },
      data: {
        messages: [...prior, ...messages],
        ...(usageDelta
          ? { usage: addUsage(row.usage as AssistantUsage | null, usageDelta) as Json }
          : {}),
      },
    })
  })
}

export async function recordConsent(id: string, accountId: string, consentVersion: string) {
  const r = await prisma.assistantConversation.updateMany({
    where: { id, accountId },
    data: { consentVersion },
  })
  return r.count === 1
}

// ─── Proposals ──────────────────────────────────────────────────────────────

export async function createProposal(input: {
  conversationId: string
  accountId: string
  siteId: string
  kind: string
  payload: Json
  preview: Json
  actorUserId: string
  impersonatorId?: string | null
  now?: Date
  ttlMs?: number
}) {
  // The conversation must belong to the same account — a proposal can't be attached to someone else's.
  const convo = await getConversationForAccount(input.conversationId, input.accountId)
  if (!convo) return null
  const now = input.now ?? new Date()
  return prisma.assistantAction.create({
    data: {
      conversationId: input.conversationId,
      accountId: input.accountId,
      siteId: input.siteId,
      kind: input.kind,
      payload: input.payload,
      preview: input.preview,
      status: S.PROPOSED,
      actorUserId: input.actorUserId,
      impersonatorId: input.impersonatorId ?? null,
      expiresAt: new Date(now.getTime() + (input.ttlMs ?? ASSISTANT_PROPOSAL_TTL_MS)),
    },
  })
}

export async function getProposalForAccount(id: string, accountId: string) {
  return prisma.assistantAction.findFirst({ where: { id, accountId } })
}

export async function listProposalsForConversation(conversationId: string, accountId: string) {
  return prisma.assistantAction.findMany({
    where: { conversationId, accountId },
    orderBy: { createdAt: 'asc' },
  })
}

/**
 * proposed → applied. Compare-and-set on status AND expiry: a lapsed proposal cannot be applied even
 * if the sweeper has not run. Returns true only for the single caller that won the transition.
 */
export async function markApplied(
  id: string,
  accountId: string,
  snapshot: Json | null,
  resultSummary: Json | null,
  now: Date = new Date(),
) {
  const r = await prisma.assistantAction.updateMany({
    where: { id, accountId, status: S.PROPOSED, expiresAt: { gt: now } },
    data: {
      status: S.APPLIED,
      appliedAt: now,
      snapshot: snapshot ?? Prisma.DbNull,
      resultSummary: resultSummary ?? Prisma.DbNull,
    },
  })
  return r.count === 1
}

export async function markRejected(id: string, accountId: string) {
  const r = await prisma.assistantAction.updateMany({
    where: { id, accountId, status: S.PROPOSED },
    data: { status: S.REJECTED },
  })
  return r.count === 1
}

/** proposed → failed (apply threw / validation rejected at apply time). */
export async function markFailed(id: string, accountId: string, resultSummary?: Json | null) {
  const r = await prisma.assistantAction.updateMany({
    where: { id, accountId, status: S.PROPOSED },
    data: { status: S.FAILED, resultSummary: resultSummary ?? Prisma.DbNull },
  })
  return r.count === 1
}

/** applied → undone, only inside the undo window (D10). */
export async function markUndone(id: string, accountId: string, now: Date = new Date()) {
  const r = await prisma.assistantAction.updateMany({
    where: {
      id,
      accountId,
      status: S.APPLIED,
      appliedAt: { gt: new Date(now.getTime() - ASSISTANT_UNDO_WINDOW_MS) },
    },
    data: { status: S.UNDONE, undoneAt: now },
  })
  return r.count === 1
}

/** Sweeper: proposed rows past `expiresAt` → expired. Returns how many. */
export async function expireStaleProposals(now: Date = new Date()) {
  const r = await prisma.assistantAction.updateMany({
    where: { status: S.PROPOSED, expiresAt: { lte: now } },
    data: { status: S.EXPIRED },
  })
  return r.count
}

// ─── Uploads ────────────────────────────────────────────────────────────────

export async function createUpload(input: {
  accountId: string
  siteId?: string | null
  blobKey: string
  url: string
  mime: string
  sizeBytes: number
  purpose?: 'document' | 'photo' | null
  now?: Date
  ttlMs?: number
}) {
  const now = input.now ?? new Date()
  return prisma.assistantUpload.create({
    data: {
      accountId: input.accountId,
      siteId: input.siteId ?? null,
      blobKey: input.blobKey,
      url: input.url,
      mime: input.mime,
      sizeBytes: input.sizeBytes,
      purpose: input.purpose ?? null,
      expiresAt: new Date(now.getTime() + (input.ttlMs ?? ASSISTANT_UPLOAD_TTL_MS)),
    },
  })
}

/** Null when missing, not owned, or already purged. */
export async function getUploadForAccount(id: string, accountId: string) {
  return prisma.assistantUpload.findFirst({ where: { id, accountId, deletedAt: null } })
}

/** Purge-job input (cross-account by design — cron only, never reachable from a request). */
export async function listExpiredUploads(now: Date = new Date(), limit = 200) {
  return prisma.assistantUpload.findMany({
    where: { expiresAt: { lte: now }, deletedAt: null },
    orderBy: { expiresAt: 'asc' },
    take: limit,
  })
}

/** Stamp after the blob is deleted. Idempotent: a second call returns false. */
export async function markUploadDeleted(id: string, now: Date = new Date()) {
  const r = await prisma.assistantUpload.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: now },
  })
  return r.count === 1
}

// ─── Aerial photo → layout (track 030 S7) ──────────────────────────────────

/** A running extraction older than this is presumed dead (the route's maxDuration is 300 s). */
export const AERIAL_STALE_RUNNING_MS = 10 * 60 * 1000

export type AerialExtractionStatus = 'running' | 'done' | 'failed'

/**
 * `assistant_upload.aerial`. `startedAt` (ISO) doubles as the claim token: only the runner that
 * claimed a given attempt can finish it, so a presumed-dead runner waking up late cannot overwrite
 * a newer attempt. The descriptor is opaque here (`AerialDescriptorV1` in @repo/agent — this
 * package stays SDK-free).
 */
export interface AerialState {
  status: AerialExtractionStatus
  startedAt: string
  finishedAt?: string
  descriptor?: unknown
  usage?: AssistantUsage
  model?: string
  error?: string
}

/** Save the alignment georef (opaque `Georef` JSON, validated by the caller). False when not owned. */
export async function setUploadGeoref(id: string, accountId: string, georef: Json) {
  const r = await prisma.assistantUpload.updateMany({
    where: { id, accountId, deletedAt: null },
    data: { georef },
  })
  return r.count === 1
}

export type AerialClaim =
  | { claimed: true; startedAt: string }
  | { claimed: false; state: AerialState | null; reason: 'not_found' | 'busy' | 'done' }

/**
 * Compare-and-set claim of the (single, billable) extraction for an upload: succeeds only from no
 * state, `failed`, or a `running` attempt older than `AERIAL_STALE_RUNNING_MS`. Exactly one of
 * several racing callers wins; the rest get the current state back (so a cache hit never bills).
 */
export async function claimAerialExtraction(id: string, accountId: string, now: Date = new Date()): Promise<AerialClaim> {
  const startedAt = now.toISOString()
  const staleBefore = new Date(now.getTime() - AERIAL_STALE_RUNNING_MS).toISOString()
  const state = { status: 'running', startedAt } satisfies AerialState
  const won = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE assistant_upload SET aerial = ${JSON.stringify(state)}::jsonb
    WHERE id = ${id} AND account_id = ${accountId} AND deleted_at IS NULL
      AND (
        aerial IS NULL
        OR aerial->>'status' = 'failed'
        OR (aerial->>'status' = 'running' AND (aerial->>'startedAt')::timestamptz < ${staleBefore}::timestamptz)
      )
    RETURNING id`
  if (won.length === 1) return { claimed: true, startedAt }
  const row = await getUploadForAccount(id, accountId)
  if (!row) return { claimed: false, state: null, reason: 'not_found' }
  const current = (row.aerial ?? null) as AerialState | null
  return { claimed: false, state: current, reason: current?.status === 'done' ? 'done' : 'busy' }
}

async function finishAerial(id: string, accountId: string, startedAt: string, next: AerialState) {
  const r = await prisma.$executeRaw`
    UPDATE assistant_upload SET aerial = ${JSON.stringify(next)}::jsonb
    WHERE id = ${id} AND account_id = ${accountId} AND deleted_at IS NULL
      AND aerial->>'status' = 'running' AND aerial->>'startedAt' = ${startedAt}`
  return r === 1
}

/** running → done for the attempt claimed at `startedAt`. False when the attempt is no longer current. */
export async function saveAerialDescriptor(
  id: string,
  accountId: string,
  startedAt: string,
  result: { descriptor: unknown; usage?: AssistantUsage; model?: string },
  now: Date = new Date(),
) {
  return finishAerial(id, accountId, startedAt, {
    status: 'done',
    startedAt,
    finishedAt: now.toISOString(),
    descriptor: result.descriptor,
    ...(result.usage ? { usage: result.usage } : {}),
    ...(result.model ? { model: result.model } : {}),
  })
}

/** running → failed for the attempt claimed at `startedAt` (a later call may re-claim). */
export async function failAerialExtraction(
  id: string,
  accountId: string,
  startedAt: string,
  error: string,
  usage?: AssistantUsage,
  now: Date = new Date(),
) {
  return finishAerial(id, accountId, startedAt, {
    status: 'failed',
    startedAt,
    finishedAt: now.toISOString(),
    error: error.slice(0, 500),
    ...(usage ? { usage } : {}),
  })
}
