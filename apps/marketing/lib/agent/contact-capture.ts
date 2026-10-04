/**
 * Deterministic contact capture (track 027 P5).
 *
 * A prospect who types their email or phone into the sales chat is asking to be contacted. Whether
 * that becomes a demo request must not depend on the model: Haiku 4.5 — the live model (D7) —
 * repeatedly answered "+34 600 123 456, call me tomorrow" by asking for a name first and booking
 * nothing, even with explicit prompt rules and an example. So the SERVER extracts the contact from
 * the prospect's own words and books the demo before the model replies (`runTurn`); the model sees
 * it as an already-completed `request_demo` and only has to talk.
 *
 * Extracted values are verbatim substrings of the message, so they pass the same grounding check
 * as model-proposed tool calls by construction.
 */

const EMAIL_RE = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[A-Za-z]{2,}/
/** A run of digits with phone punctuation; whether it IS a phone is decided by `isPhone`. */
const PHONE_CANDIDATE_RE = /\(?\+?\(?\d[\d\s().-]{5,}\d/g

/**
 * Phone, not a date, price or count: with a leading + it needs 7–15 digits (E.164); without one it
 * needs at least 9 (local mobiles in our markets are 9+, and "2026-10-04" is 8).
 */
function isPhone(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, '').length
  return candidate.replace(/^\(/, '').trim().startsWith('+') ? digits >= 7 && digits <= 15 : digits >= 9 && digits <= 15
}

export function extractContact(message: string): { email?: string; phone?: string } {
  const out: { email?: string; phone?: string } = {}
  const email = message.match(EMAIL_RE)?.[0]?.replace(/[.]+$/, '')
  if (email) out.email = email
  // Don't read digits inside the email (e.g. jordi2024@…) as a phone.
  const rest = email ? message.replace(email, ' ') : message
  for (const m of rest.matchAll(PHONE_CANDIDATE_RE)) {
    const candidate = m[0].trim()
    if (isPhone(candidate)) {
      out.phone = candidate
      break
    }
  }
  return out
}
