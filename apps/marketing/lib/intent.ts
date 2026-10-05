import { MAX_SUNBEDS } from './places.ts'

/**
 * Rules-first reading of the command bar (track 027 D11): "Platja de Muro, 80 beds and a bar" →
 * beach query + sunbed count + what else they run. Deterministic and free; the agent model is
 * only for text these rules can't place. A count needs a unit word ("80 beds", "80 hamacas") —
 * a bare number is too often part of an address ("Carrer 5").
 */

export type Run = 'fnb' | 'rentals' | 'tables'

export interface Intent {
  /** What to send to Places autocomplete: the text minus the count and the extras. */
  query: string
  count: number | null
  runs: Run[]
}

const BED_UNIT = String.raw`(?:sun\s?beds?|beds?|sun\s?loungers?|loungers?|hamacas?|tumbonas?|gandulas?|aurinkotuole(?:ja|ita)|aurinkotuolia|aurinkotuolit?|tuolia|tuolit?)`
const COUNT_RE = new RegExp(String.raw`(?:^|[\s,;(])(\d{1,5})\s*(?:x\s*)?${BED_UNIT}(?=$|[\s,;.)!?])`, 'iu')

const RUN_WORDS: Record<Run, string> = {
  fnb: String.raw`beach\s?bar|bar|chiringuito|kiosko?|drinks?|food|caf[eé]|comida|bebidas|baari|kahvila|ravintola`,
  rentals: String.raw`rentals?|paddle\s?boards?|paddle|sup|kayaks?|pedal\s?boats?|hidropedales|surf\s?boards?|alquiler|vuokraus|vuokra`,
  tables: String.raw`restaurant|restaurante|tables?|mesas?|pöydät|pöytiä`,
}
const CONNECTOR = String.raw`(?:and|with|plus|also|y|con|también|ja|sekä|\+|&)`
const ARTICLE = String.raw`(?:an?|the|un|una|unos|unas|el|la|los|las)`

function runRe(words: string) {
  return new RegExp(String.raw`(?:${CONNECTOR}\s+)?(?:${ARTICLE}\s+)?(?<![\p{L}\d])(?:${words})(?![\p{L}\d])`, 'giu')
}

export function parseIntent(text: string): Intent {
  let rest = text.normalize('NFC')
  let count: number | null = null
  const m = COUNT_RE.exec(rest)
  if (m) {
    const n = Number(m[1])
    if (n >= 1) count = Math.min(n, MAX_SUNBEDS)
    rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length)
  }
  const runs: Run[] = []
  for (const run of Object.keys(RUN_WORDS) as Run[]) {
    const re = runRe(RUN_WORDS[run])
    if (re.test(rest)) {
      runs.push(run)
      rest = rest.replace(runRe(RUN_WORDS[run]), ' ')
    }
  }
  const query = rest
    .replace(new RegExp(String.raw`(?<![\p{L}\d])${CONNECTOR}(?![\p{L}\d])`, 'giu'), ' ')
    .replace(/\s+/g, ' ')
    // A preposition orphaned by removing its object ("alquiler de kayaks" → "de").
    .replace(new RegExp(String.raw`\s(?:de|del|of|for|para)(?=\s*(?:,|$))`, 'giu'), '')
    .replace(/\s*,\s*(,\s*)*/g, ', ')
    .replace(/^[\s,;.]+|[\s,;.!?]+$/g, '')
    .trim()
  return { query, count, runs }
}

const QUESTION_START = /^(do|does|did|how|what|which|who|why|when|can|could|is|are|will|would|should|may|qu[eé]|c[oó]mo|cu[aá]nto|cu[aá]ndo|cu[aá]l|por qu[eé]|puedo|pod[eé]is|puede|hay|es|son|ten[eé]is|tienen|funciona|onko|ovatko|miten|mit[aä]|paljonko|voiko|voinko|kuinka|miksi|milloin)\b/iu

/**
 * Text meant for the agent rather than the beach search: a question, by mark or by its first word
 * (EN/ES/FI). "Where" is deliberately NOT a question start — "Where's Playa X" is a place search.
 */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim()
  return t.includes('?') || t.includes('¿') || QUESTION_START.test(t)
}

/** A count typed on its own while the count is being asked: "80", "80 beds", "about 80". */
export function parseBareCount(text: string): number | null {
  const withUnit = parseIntent(text)
  if (withUnit.count !== null && !withUnit.query) return withUnit.count
  const m = /^\s*(?:about|around|unos|unas|noin|n\.)?\s*(\d{1,5})\s*$/iu.exec(text)
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 ? Math.min(n, MAX_SUNBEDS) : null
}

/** A typed price while the price is being asked: "25", "€25", "25 €", "25 euros". */
export function parsePrice(text: string): number | null {
  const m = /^\s*€?\s*(\d{1,3})(?:[.,]\d{1,2})?\s*(?:€|eur|euros?|e)?\s*$/iu.exec(text)
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 && n <= 500 ? n : null
}

/** "Yes / build it / go" while the Build button is on screen. */
export function isAffirmative(text: string): boolean {
  return /^\s*(yes|yep|yeah|ok|okay|sure|go|build( it)?|let'?s go|s[ií]|vale|claro|adelante|construir|kyll[aä]|joo|ok(ei)?|rakenna)\s*[.!]*\s*$/iu.test(text)
}
