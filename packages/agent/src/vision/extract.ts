/**
 * One vision call: an aerial beach photo -> a validated `AerialDescriptorV1` (track 030 S7).
 *
 * Structured output: the request sets `output_config.format = { type: 'json_schema', schema }`
 * (GA in the installed @anthropic-ai/sdk 0.133 `MessageCreateParams.output_config`), so the reply's
 * text block IS the descriptor JSON — no tool round-trip. The API constrains shape only; ranges
 * are re-checked by `validateAerialDescriptor` before anything trusts the result.
 *
 * The caller resizes the image (design: 2000 px long edge) and passes the size it actually sent —
 * coordinates come back in that frame. Streams (`messages.stream(...).finalMessage()`) because a
 * high-effort thinking turn can outlast the SDK's non-streaming time guard.
 */
import Anthropic from '@anthropic-ai/sdk'
import { claudeCapabilities } from '../claude-model.ts'
import type { ImageSize } from '../geo/georef.ts'
import { AERIAL_DESCRIPTOR_SCHEMA, validateAerialDescriptor, type AerialDescriptorV1 } from './aerial-schema.ts'

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** The slice of the Anthropic client this module uses (a real `Anthropic` satisfies it). */
export interface VisionClient {
  messages: {
    stream(body: Anthropic.MessageStreamParams, options?: { signal?: AbortSignal }): { finalMessage(): Promise<Anthropic.Message> }
  }
}

export type AerialExtractError =
  | { kind: 'refusal'; message: string }
  | { kind: 'max_tokens'; message: string }
  | { kind: 'invalid_json'; message: string }
  | { kind: 'schema_invalid'; message: string; errors: string[] }
  | { kind: 'api_error'; message: string }

export interface AerialExtractUsage {
  inputTokens: number
  outputTokens: number
}

export type AerialExtractResult =
  | { ok: true; descriptor: AerialDescriptorV1; usage: AerialExtractUsage; model: string }
  | { ok: false; error: AerialExtractError; usage?: AerialExtractUsage }

export const AERIAL_EXTRACTION_PROMPT = `You are reading an aerial (drone) photo of a beach to help a beach operator map their sunbed layout.

The image you are given is exactly {W} x {H} pixels. Report every coordinate in THAT pixel frame: origin at the top-left corner, x to the right, y downward.

Report pixel-space observations only — never metres, never guesses about what is outside the frame.

1. view: "nadir" if the camera looks (nearly) straight down, "oblique" if it looks at an angle (horizon or strong perspective visible), "unclear" otherwise.
2. usable: false if the photo cannot support a sunbed layout (no sunbeds, oblique, too blurry or too far away to count beds). When false, still fill the other fields as best you can and leave parcels empty if you cannot count.
3. bed: the median length and width in pixels of ONE sunbed (lounger) footprint as seen from above. 0 and 0 if none are visible.
4. shoreline: points = a few pixel points along the water line (empty if no water is visible); seaSide = the image edge the sea is on ("top", "bottom", "left", "right") or "none".
5. parcels: each regular block of sunbeds laid out in straight, parallel rows is one parcel. For each parcel:
   - rows, ordered FRONT FIRST: the row nearest the sea first, then each row further from the sea.
   - for each row: first and last = the pixel centre of the first and last UNIT in that row. A unit is a single sunbed, or — when beds stand in pairs sharing one parasol — the pair, whose centre is the parasol. Either end of the row may be "first".
   - units = how many units the row has, counting hidden ones you can infer from the regular spacing (a pair counts as ONE unit). occludedBeds = how many BEDS of the row you inferred rather than saw.
   - paired = true when the row's beds stand in pairs sharing a parasol.
   - if rows in one block have different counts or are offset from each other, still report them in the same parcel, row by row, exactly as they are.
   - facing: "sea" if a person lying on the beds would look toward the sea (feet toward the water), "land" if away from it, "unclear" if you cannot tell.
   - confidence (0 to 1) for the parcel and for each row: how sure you are of the count and the endpoints.
6. ignored: short notes about beds or structures you deliberately left out (stacked or scattered beds, kiosks, umbrellas without beds).

Count carefully. Prefer reporting a row with a lower confidence over leaving it out; never invent rows you cannot see.`

/** A real client (reads `ANTHROPIC_API_KEY`), so apps need no direct SDK dependency. */
export function createVisionClient(): VisionClient {
  return new Anthropic()
}

/** The prompt with the image size filled in. */
export function aerialPrompt(image: ImageSize, template = AERIAL_EXTRACTION_PROMPT): string {
  return template.replaceAll('{W}', String(image.w)).replaceAll('{H}', String(image.h))
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(s)
}

export interface ExtractAerialInput {
  client: VisionClient
  model: string
  image: { bytes: Uint8Array; mediaType: ImageMediaType; width: number; height: number }
  /** Overrides the prompt template (`{W}` / `{H}` are substituted). */
  prompt?: string
  effort?: Effort
  maxTokens?: number
  signal?: AbortSignal
}

/** The request body — exported so tests can pin it without the network. */
export function buildAerialRequest(input: Omit<ExtractAerialInput, 'client' | 'signal'>): Anthropic.MessageStreamParams {
  const size = { w: input.image.width, h: input.image.height }
  const caps = claudeCapabilities(input.model)
  return {
    model: input.model,
    max_tokens: input.maxTokens ?? 16000,
    thinking: { type: 'adaptive' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: input.image.mediaType, data: toBase64(input.image.bytes) } },
          { type: 'text', text: aerialPrompt(size, input.prompt) },
        ],
      },
    ],
    output_config: {
      ...(caps.effort ? { effort: input.effort ?? 'high' } : {}),
      format: { type: 'json_schema', schema: AERIAL_DESCRIPTOR_SCHEMA },
    },
  }
}

export async function extractAerialDescriptor(input: ExtractAerialInput): Promise<AerialExtractResult> {
  let message: Anthropic.Message
  try {
    message = await input.client.messages.stream(buildAerialRequest(input), input.signal ? { signal: input.signal } : undefined).finalMessage()
  } catch (e) {
    return { ok: false, error: { kind: 'api_error', message: e instanceof Error ? e.message : String(e) } }
  }
  const usage = { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens }
  if (message.stop_reason === 'refusal')
    return { ok: false, usage, error: { kind: 'refusal', message: 'The model declined to read this photo' } }
  if (message.stop_reason === 'max_tokens')
    return { ok: false, usage, error: { kind: 'max_tokens', message: 'The model ran out of output tokens before finishing the descriptor' } }

  const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, usage, error: { kind: 'invalid_json', message: 'The reply was not valid JSON' } }
  }
  const v = validateAerialDescriptor(parsed, { w: input.image.width, h: input.image.height })
  if (!v.ok) return { ok: false, usage, error: { kind: 'schema_invalid', message: 'The descriptor failed validation', errors: v.errors } }
  return { ok: true, descriptor: v.descriptor, usage, model: message.model }
}
