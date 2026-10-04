/**
 * "Book a demo" form rules (track 027 P3) — pure, shared by the client form and the server action.
 *
 * Bot protection is deliberately third-party-free (founder decision 2026-10-04): a honeypot field
 * real people never see, a minimum fill time, and the action's per-IP rate limit. Turnstile only
 * if abuse shows up.
 */

/** Version of the privacy notice the consent checkbox refers to; stored on the lead. Bump with the notice. */
export const CONSENT_VERSION = '2026-10-04.2' // .2: the AI chat (Anthropic, transcripts, contact-in-chat)

/** Faster than this from render to submit is a script, not a person typing a name and an email. */
export const MIN_FILL_MS = 3000

export const HONEYPOT_FIELD = 'website'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE_RE = /^\(?\+?[\d\s().-]+$/

export type DemoRequestError = 'name' | 'contact' | 'email' | 'phone' | 'consent' | 'tooLong'

export interface DemoRequestInput {
  contactName: string
  email: string | null
  phone: string | null
  businessName: string | null
  message: string | null
}

const clean = (v: FormDataEntryValue | null | undefined, max: number): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s.slice(0, max) : null
}

export function parseDemoRequest(form: {
  get(name: string): FormDataEntryValue | null
}): { ok: true; value: DemoRequestInput } | { ok: false; errors: DemoRequestError[] } {
  const errors: DemoRequestError[] = []
  const contactName = clean(form.get('name'), 120)
  const email = clean(form.get('email'), 254)
  const phone = clean(form.get('phone'), 40)
  const businessName = clean(form.get('business'), 200)
  const rawMessage = typeof form.get('message') === 'string' ? (form.get('message') as string).trim() : ''

  if (!contactName) errors.push('name')
  if (!email && !phone) errors.push('contact')
  if (email && !EMAIL_RE.test(email)) errors.push('email')
  if (phone) {
    const digits = phone.replace(/\D/g, '').length
    if (!PHONE_RE.test(phone) || digits < 7 || digits > 15) errors.push('phone')
  }
  if (form.get('consent') !== 'on') errors.push('consent')
  if (rawMessage.length > 2000) errors.push('tooLong')

  if (errors.length) return { ok: false, errors }
  return { ok: true, value: { contactName: contactName!, email, phone, businessName, message: rawMessage || null } }
}

/**
 * True when the submission looks automated. The caller answers a bot with the SAME success
 * response a person gets — telling it what tripped the check only teaches it to avoid it.
 */
export function looksAutomated(form: { get(name: string): FormDataEntryValue | null }, now: number): boolean {
  const trap = form.get(HONEYPOT_FIELD)
  if (typeof trap === 'string' && trap.trim() !== '') return true
  // Number(null) is 0 — "rendered in 1970" would sail past a timing check, so require digits.
  const raw = form.get('rendered_at')
  if (typeof raw !== 'string' || !/^\d{10,16}$/.test(raw)) return true
  return now - Number(raw) < MIN_FILL_MS
}
