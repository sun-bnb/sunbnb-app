/**
 * Aerial photo -> vision descriptor, at most ONE billable model call per upload (track 030 S7).
 *
 * Order matters for cost:
 *   1. CAS claim on `assistant_upload.aerial` (`claimAerialExtraction`). A cached `done`, or a fresh
 *      `running` attempt, is answered from the row -- no counter is touched, nothing is billed.
 *   2. Only the claim winner spends limits: AI-turn gate (per-account burst + the GLOBAL daily budget),
 *      the aerial sub-cap (3/day) and the extraction-job cap (10/day). A refusal marks the attempt
 *      `failed` so a later call (tomorrow) can re-claim.
 *   3. Resize to the shared aerial frame (`prepareAerialImage`), one structured-output vision call,
 *      validated descriptor + usage stored on the row.
 */
import type { AerialDescriptorV1 } from '@repo/agent/vision/aerial-schema'
import { createVisionClient, extractAerialDescriptor, type ExtractAerialInput, type AerialExtractResult } from '@repo/agent/vision/extract'
import {
  claimAerialExtraction,
  failAerialExtraction,
  saveAerialDescriptor,
  type AerialClaim,
  type AerialState,
  type AssistantUsage,
} from '@repo/data/assistant'
import { extractionModelId } from '../config'
import { allowAerialExtraction, allowAssistantTurn, allowExtractionJob } from '../limits'
import { readUploadBlob } from '../uploads'
import { prepareAerialImage, type AerialImage } from './image'

export type ExtractStatus = 'running' | 'done' | 'failed'

export interface ExtractResponse {
  status: ExtractStatus
  /** On failed: a machine code (rate_limited | budget | extraction_limit | aerial_limit | refusal | unreadable | ...). */
  error?: string
  /** On done: what the model saw, for the UI hint. */
  usable?: boolean
  view?: string
  parcels?: number
}

export interface AerialExtractDeps {
  claim: (id: string, accountId: string) => Promise<AerialClaim>
  save: typeof saveAerialDescriptor
  fail: typeof failAerialExtraction
  allowTurn: (userId: string) => Promise<'ok' | 'rate_limited' | 'budget'>
  allowAerial: (userId: string) => Promise<boolean>
  allowJob: (userId: string) => Promise<boolean>
  read: (url: string) => Promise<Buffer>
  prepare: (buf: Buffer) => Promise<AerialImage>
  extract: (input: Omit<ExtractAerialInput, 'client'>) => Promise<AerialExtractResult>
}

export const defaultAerialExtractDeps: AerialExtractDeps = {
  claim: (id, accountId) => claimAerialExtraction(id, accountId),
  save: saveAerialDescriptor,
  fail: failAerialExtraction,
  allowTurn: (userId) => allowAssistantTurn(userId),
  allowAerial: (userId) => allowAerialExtraction(userId),
  allowJob: (userId) => allowExtractionJob(userId),
  read: readUploadBlob,
  prepare: prepareAerialImage,
  extract: (input) => extractAerialDescriptor({ ...input, client: createVisionClient() }),
}

/** The response for a stored state (cache hit / someone else's attempt). */
export function responseForState(state: AerialState | null | undefined): ExtractResponse {
  if (!state) return { status: 'failed', error: 'not_found' }
  if (state.status === 'done') {
    const d = state.descriptor as Partial<AerialDescriptorV1> | undefined
    return { status: 'done', usable: d?.usable ?? false, view: d?.view, parcels: Array.isArray(d?.parcels) ? d!.parcels!.length : 0 }
  }
  if (state.status === 'failed') return { status: 'failed', error: state.error ?? 'failed' }
  return { status: 'running' }
}

function toUsage(u?: { inputTokens: number; outputTokens: number }): AssistantUsage | undefined {
  return u ? { inputTokens: u.inputTokens, outputTokens: u.outputTokens } : undefined
}

export async function runAerialExtraction(
  input: { uploadId: string; accountId: string; userId: string; url: string; signal?: AbortSignal },
  deps: AerialExtractDeps = defaultAerialExtractDeps,
): Promise<ExtractResponse> {
  const { uploadId, accountId, userId } = input
  const claim = await deps.claim(uploadId, accountId)
  if (!claim.claimed) return claim.reason === 'not_found' ? { status: 'failed', error: 'not_found' } : responseForState(claim.state)
  const { startedAt } = claim
  const refuse = async (error: string): Promise<ExtractResponse> => {
    await deps.fail(uploadId, accountId, startedAt, error)
    return { status: 'failed', error }
  }

  const turn = await deps.allowTurn(userId)
  if (turn !== 'ok') return refuse(turn)
  if (!(await deps.allowAerial(userId))) return refuse('aerial_limit')
  if (!(await deps.allowJob(userId))) return refuse('extraction_limit')

  let image: AerialImage
  try {
    image = await deps.prepare(await deps.read(input.url))
  } catch (err) {
    console.error('[assistant] aerial image read failed', err)
    return refuse('unreadable')
  }

  const result = await deps.extract({
    model: extractionModelId(),
    image: { bytes: image.data, mediaType: image.mediaType, width: image.width, height: image.height },
    effort: 'high',
    ...(input.signal ? { signal: input.signal } : {}),
  })
  if (!result.ok) {
    console.error('[assistant] aerial extraction failed', result.error)
    const error = result.error.kind === 'refusal' ? 'refusal' : result.error.kind === 'api_error' ? 'unavailable' : 'unreadable'
    await deps.fail(uploadId, accountId, startedAt, error, toUsage(result.usage))
    return { status: 'failed', error }
  }
  const saved = await deps.save(uploadId, accountId, startedAt, { descriptor: result.descriptor, usage: toUsage(result.usage), model: result.model })
  // Lost the attempt (presumed dead and re-claimed meanwhile): the newer attempt's state wins.
  if (!saved) return { status: 'running' }
  return responseForState({ status: 'done', startedAt, descriptor: result.descriptor })
}
