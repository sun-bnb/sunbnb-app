import { describe, expect, it } from 'vitest'
import { validateJsonSchema } from './schema.ts'

const schema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    count: { type: 'integer', minimum: 1, maximum: 10 },
    kind: { type: 'string', enum: ['a', 'b'] },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 2 },
  },
  required: ['name'],
  additionalProperties: false,
}

describe('validateJsonSchema', () => {
  it('accepts a valid input', () => {
    expect(validateJsonSchema(schema, { name: 'x', count: 3, kind: 'a', tags: ['t'] })).toEqual([])
  })
  it('reports missing, extra, mistyped, out-of-range and off-enum fields', () => {
    expect(validateJsonSchema(schema, { count: 11, kind: 'c', tags: ['t', 1, 'u'], extra: true })).toEqual([
      'input.name is required',
      'input.count must be <= 10',
      'input.kind must be one of: a, b',
      'input.tags must have at most 2 items',
      'input.tags[1] must be string',
      'unknown field: extra',
    ])
  })
  it('treats a non-integer as wrong type for integer', () => {
    expect(validateJsonSchema(schema, { name: 'x', count: 2.5 })).toEqual(['input.count must be integer'])
  })
  it('rejects a non-object root', () => {
    expect(validateJsonSchema(schema, [1])).toEqual(['input must be object'])
  })
})
