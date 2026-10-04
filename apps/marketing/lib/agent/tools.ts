/**
 * The lead agent's tools, and the server-side validation every call goes through.
 *
 * The model never writes anything itself: it PROPOSES a call, `validateToolCall` checks the
 * arguments, and only a valid call is executed. An invalid call is returned to the model as an
 * error so it can ask the prospect again (e.g. for a correctly formatted email).
 */
import type { ToolDefinition } from './model.ts'

export const BUSINESS_TYPES = ['beach_club', 'sunbed_concession', 'hotel', 'restaurant', 'municipality', 'other'] as const

export const MAX_SUNBEDS = 5000

export const TOOLS: ToolDefinition[] = [
  {
    name: 'update_lead',
    description:
      'Save details the prospect has told you about themselves or their business. Call it as soon as they share any of these. Only include fields the prospect actually stated.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Contact person name' },
        email: { type: 'string', description: 'Email address, exactly as given' },
        phone: { type: 'string', description: 'Phone or WhatsApp number, with country code if given' },
        business_name: { type: 'string' },
        business_type: { type: 'string', enum: [...BUSINESS_TYPES] },
        sunbed_count: { type: 'integer', description: 'Number of sunbeds they operate' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'adjust_mockup',
    description:
      'Regenerate the beach mockup with a different number of sunbeds when the prospect corrects or changes the count.',
    parameters: {
      type: 'object',
      properties: { sunbed_count: { type: 'integer', minimum: 1, maximum: MAX_SUNBEDS } },
      required: ['sunbed_count'],
      additionalProperties: false,
    },
  },
  {
    name: 'request_demo',
    description:
      'Ask the Sunbnb team to contact the prospect for a demo or call. Call it as soon as the prospect wants one and you have their email or phone, from this message or earlier. Include any contact details they just gave. Every other field is OPTIONAL: fill preferred_time and notes only from what they already said, and never ask for them before calling — the team gathers the rest on the call.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Contact person name, if given' },
        email: { type: 'string', description: 'Email address, exactly as given' },
        phone: { type: 'string', description: 'Phone or WhatsApp number, exactly as given' },
        preferred_time: { type: 'string', description: 'Optional. When they would like to be contacted, in their words, if they said' },
        notes: { type: 'string', description: 'Optional. Short summary of what they want to see or ask, if they said' },
      },
      additionalProperties: false,
    },
  },
]

export type ToolName = 'update_lead' | 'adjust_mockup' | 'request_demo'

export type ValidationResult = { ok: true } | { ok: false; errors: string[] }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
// Digits with an optional leading + (possibly inside a parenthesis), spaces, dashes, dots and parentheses; 7–15 digits in total (E.164 max).
const PHONE_CHARS_RE = /^\(?\+?[\d\s().-]+$/

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function checkSunbedCount(v: unknown, errors: string[]) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > MAX_SUNBEDS) {
    errors.push(`sunbed_count must be a whole number between 1 and ${MAX_SUNBEDS}`)
  }
}

function checkAllowedKeys(args: Record<string, unknown>, allowed: string[], errors: string[]) {
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) errors.push(`unknown field: ${key}`)
  }
}

/**
 * Contact details must be GROUNDED in what the prospect typed. A model asked to save
 * "maria at chiringuitosol dot" happily completes it to a perfectly valid
 * `maria@chiringuitosol.com` — no format check can catch that, so the server checks the value
 * against the prospect's own words instead of trusting the model's transcription.
 */
function groundedIn(value: string, userText: string, normalise: (s: string) => string): boolean {
  const v = normalise(value)
  return v.length > 0 && normalise(userText).includes(v)
}
const emailNorm = (s: string) => s.toLowerCase().replace(/\s/g, '')
const digitsOnly = (s: string) => s.replace(/\D/g, '')

/** Name/email/phone checks shared by every tool that accepts contact details. */
function checkContact(args: Record<string, unknown>, userText: string | undefined, errors: string[]) {
  if ('name' in args && (typeof args.name !== 'string' || !args.name.trim())) {
    errors.push('name must be a non-empty string')
  }
  if ('email' in args) {
    if (typeof args.email !== 'string' || !EMAIL_RE.test(args.email.trim())) {
      errors.push('email is not a valid email address; ask the prospect to confirm it')
    } else if (userText !== undefined && !groundedIn(args.email, userText, emailNorm)) {
      errors.push('the prospect did not write this email address; never complete or guess it, ask them to type it again')
    }
  }
  if ('phone' in args) {
    const phone = args.phone
    const digits = typeof phone === 'string' ? digitsOnly(phone) : ''
    if (typeof phone !== 'string' || !PHONE_CHARS_RE.test(phone.trim()) || digits.length < 7 || digits.length > 15) {
      errors.push('phone is not a valid phone number; ask the prospect to confirm it')
    } else if (userText !== undefined && !groundedIn(phone, userText, digitsOnly)) {
      errors.push('the prospect did not write this phone number; never complete or guess it, ask them to type it again')
    }
  }
}

/**
 * `known` is what the lead already holds — `request_demo` needs a way to reach the prospect,
 * either saved earlier in the conversation or never — plus, when given, everything the
 * prospect has written, which contact details must be found in.
 */
export function validateToolCall(
  name: string,
  args: unknown,
  known: { email?: string; phone?: string; userText?: string } = {},
): ValidationResult {
  const errors: string[] = []
  if (!isPlainObject(args)) return { ok: false, errors: ['arguments must be a JSON object'] }

  switch (name) {
    case 'update_lead': {
      checkAllowedKeys(args, ['name', 'email', 'phone', 'business_name', 'business_type', 'sunbed_count'], errors)
      if (Object.keys(args).length === 0) errors.push('no fields given')
      checkContact(args, known.userText, errors)
      if ('business_name' in args && (typeof args.business_name !== 'string' || !args.business_name.trim())) {
        errors.push('business_name must be a non-empty string')
      }
      if ('business_type' in args && !BUSINESS_TYPES.includes(args.business_type as (typeof BUSINESS_TYPES)[number])) {
        errors.push(`business_type must be one of: ${BUSINESS_TYPES.join(', ')}`)
      }
      if ('sunbed_count' in args) checkSunbedCount(args.sunbed_count, errors)
      break
    }
    case 'adjust_mockup':
      checkAllowedKeys(args, ['sunbed_count'], errors)
      checkSunbedCount(args.sunbed_count, errors)
      break
    case 'request_demo':
      // Carries contact details itself: smaller models reliably make ONE call per turn but often
      // stop after `update_lead` without chaining `request_demo` (qwen3:14b, 2026-10-04).
      checkAllowedKeys(args, ['name', 'email', 'phone', 'preferred_time', 'notes'], errors)
      checkContact(args, known.userText, errors)
      if (!known.email && !known.phone && !('email' in args) && !('phone' in args)) {
        errors.push('no email or phone yet; ask the prospect how to reach them')
      }
      break
    default:
      errors.push(`unknown tool: ${name}`)
  }

  return errors.length ? { ok: false, errors } : { ok: true }
}
