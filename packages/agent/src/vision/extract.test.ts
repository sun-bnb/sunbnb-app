import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { AERIAL_DESCRIPTOR_SCHEMA, type AerialDescriptorV1 } from './aerial-schema.ts'
import { buildAerialRequest, extractAerialDescriptor, type VisionClient } from './extract.ts'

const VALID: AerialDescriptorV1 = {
  image: { w: 2000, h: 1500 },
  view: 'nadir',
  usable: true,
  bed: { lengthPx: 42, widthPx: 17 },
  shoreline: { points: [{ x: 0, y: 1400 }, { x: 2000, y: 1380 }], seaSide: 'bottom' },
  parcels: [
    {
      id: 'A',
      rows: [
        { first: { x: 200, y: 1200 }, last: { x: 1800, y: 1190 }, units: 12, paired: true, occludedBeds: 2, confidence: 0.9 },
        { first: { x: 200, y: 1100 }, last: { x: 1800, y: 1090 }, units: 12, paired: true, occludedBeds: 0, confidence: 0.8 },
      ],
      facing: 'sea',
      confidence: 0.85,
    },
  ],
  ignored: ['stacked beds by the kiosk'],
}

const IMAGE = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01]), mediaType: 'image/jpeg' as const, width: 2000, height: 1500 }

function fakeClient(reply: Partial<Anthropic.Message> | Error) {
  const calls: Anthropic.MessageStreamParams[] = []
  const client: VisionClient = {
    messages: {
      stream(body) {
        calls.push(body)
        return {
          finalMessage: async () => {
            if (reply instanceof Error) throw reply
            return {
              id: 'msg_1',
              type: 'message',
              role: 'assistant',
              model: 'claude-opus-5-5',
              stop_reason: 'end_turn',
              stop_sequence: null,
              stop_details: null,
              content: [],
              usage: { input_tokens: 1800, output_tokens: 900 },
              ...reply,
            } as Anthropic.Message
          },
        }
      },
    },
  }
  return { client, calls }
}

const text = (t: string) => [{ type: 'text', text: t, citations: null }] as unknown as Anthropic.ContentBlock[]

describe('buildAerialRequest', () => {
  it('sends the image then the sized prompt, structured output, effort and adaptive thinking', () => {
    const body = buildAerialRequest({ model: 'claude-opus-5-5', image: IMAGE, effort: 'high' })
    const content = body.messages[0]!.content as Anthropic.ContentBlockParam[]
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/AAE=' } })
    expect(content[1]!.type).toBe('text')
    const prompt = (content[1] as Anthropic.TextBlockParam).text
    expect(prompt).toContain('exactly 2000 x 1500 pixels')
    expect(prompt).toMatch(/nearest the sea first/)
    expect(prompt).toMatch(/parasol/)
    expect(body.output_config).toEqual({ effort: 'high', format: { type: 'json_schema', schema: AERIAL_DESCRIPTOR_SCHEMA } })
    expect(body.thinking).toEqual({ type: 'adaptive' })
  })

  it('omits effort for a model without it, keeps the format', () => {
    const body = buildAerialRequest({ model: 'claude-haiku-4-5', image: IMAGE })
    expect(body.output_config).toEqual({ format: { type: 'json_schema', schema: AERIAL_DESCRIPTOR_SCHEMA } })
  })

  it('base64-encodes large images without blowing the call stack', () => {
    const big = new Uint8Array(300_000).fill(65)
    const body = buildAerialRequest({ model: 'claude-opus-5-5', image: { ...IMAGE, bytes: big } })
    const src = ((body.messages[0]!.content as Anthropic.ImageBlockParam[])[0]!.source as Anthropic.Base64ImageSource).data
    expect(atob(src).length).toBe(300_000)
  })
})

describe('extractAerialDescriptor', () => {
  const run = (reply: Partial<Anthropic.Message> | Error) => {
    const { client, calls } = fakeClient(reply)
    return extractAerialDescriptor({ client, model: 'claude-opus-5-5', image: IMAGE, effort: 'high' }).then((r) => ({ r, calls }))
  }

  it('returns the validated descriptor with usage', async () => {
    const { r, calls } = await run({ content: text(JSON.stringify(VALID)) })
    expect(calls).toHaveLength(1)
    expect(r).toEqual({ ok: true, descriptor: VALID, usage: { inputTokens: 1800, outputTokens: 900 }, model: 'claude-opus-5-5' })
  })

  it('refusal -> typed error', async () => {
    const { r } = await run({ stop_reason: 'refusal', content: [] })
    expect(r.ok === false && r.error.kind).toBe('refusal')
  })

  it('max_tokens -> typed error (never parses a truncated JSON)', async () => {
    const { r } = await run({ stop_reason: 'max_tokens', content: text('{"image":') })
    expect(r.ok === false && r.error.kind).toBe('max_tokens')
  })

  it('unparseable text -> invalid_json', async () => {
    const { r } = await run({ content: text('not json') })
    expect(r.ok === false && r.error.kind).toBe('invalid_json')
  })

  it('out-of-range or wrong-frame descriptor -> schema_invalid with errors', async () => {
    const bad = { ...VALID, image: { w: 1000, h: 750 } }
    const { r } = await run({ content: text(JSON.stringify(bad)) })
    expect(r.ok).toBe(false)
    if (!r.ok && r.error.kind === 'schema_invalid') expect(r.error.errors.join(' ')).toMatch(/expected 2000x1500/)
    else throw new Error('expected schema_invalid')
  })

  it('a thrown API error -> api_error', async () => {
    const { r } = await run(new Error('529 overloaded'))
    expect(r).toEqual({ ok: false, error: { kind: 'api_error', message: '529 overloaded' } })
  })
})
