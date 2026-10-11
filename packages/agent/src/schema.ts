/**
 * A small JSON-Schema checker for tool inputs — the subset tool schemas use (object / string /
 * integer / number / boolean / array, `enum`, `required`, `additionalProperties: false`,
 * `minimum` / `maximum`, `minLength` / `maxLength`, `items`, `minItems` / `maxItems`).
 *
 * Why it exists: the Claude adapter streams tool input eagerly, and then the API no longer
 * validates it — a truncated or off-schema call must be caught before a tool runs. Keywords
 * outside the subset are ignored (not rejected), so a richer schema still passes what it can.
 */
export type JsonSchema = Record<string, unknown>

function typeOk(type: unknown, v: unknown): boolean {
  switch (type) {
    case 'object':
      return typeof v === 'object' && v !== null && !Array.isArray(v)
    case 'array':
      return Array.isArray(v)
    case 'string':
      return typeof v === 'string'
    case 'integer':
      return typeof v === 'number' && Number.isInteger(v)
    case 'number':
      return typeof v === 'number' && Number.isFinite(v)
    case 'boolean':
      return typeof v === 'boolean'
    case 'null':
      return v === null
    default:
      return true
  }
}

/** Errors for `value` against `schema`, each prefixed with its path (`input.field`). Empty = valid. */
export function validateJsonSchema(schema: JsonSchema, value: unknown, path = 'input'): string[] {
  const errors: string[] = []
  const type = schema.type
  if (type !== undefined) {
    const types = Array.isArray(type) ? type : [type]
    if (!types.some((t) => typeOk(t, value))) {
      errors.push(`${path} must be ${types.join(' or ')}`)
      return errors
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => e === value)) {
    errors.push(`${path} must be one of: ${schema.enum.map(String).join(', ')}`)
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`)
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`)
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) errors.push(`${path} must be at least ${schema.minLength} characters`)
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) errors.push(`${path} must be at most ${schema.maxLength} characters`)
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) errors.push(`${path} must have at least ${schema.minItems} items`)
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) errors.push(`${path} must have at most ${schema.maxItems} items`)
    const items = schema.items
    if (items && typeof items === 'object' && !Array.isArray(items)) {
      value.forEach((item, i) => errors.push(...validateJsonSchema(items as JsonSchema, item, `${path}[${i}]`)))
    }
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>
    for (const key of Array.isArray(schema.required) ? (schema.required as string[]) : []) {
      if (!(key in obj)) errors.push(`${path}.${key} is required`)
    }
    for (const [key, v] of Object.entries(obj)) {
      const sub = props[key]
      if (sub) errors.push(...validateJsonSchema(sub, v, `${path}.${key}`))
      else if (schema.additionalProperties === false) errors.push(`unknown field: ${key}`)
    }
  }
  return errors
}
