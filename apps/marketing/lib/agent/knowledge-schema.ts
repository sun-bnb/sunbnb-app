/**
 * The shape of the agent's product knowledge (track 027): one curated entry per topic, each
 * verified against the code/tracks it cites, each with a STATUS that decides how the agent may
 * talk about it. Entries live in `knowledge.ts`; this file is the contract + renderer + guards.
 *
 * Why curated and whole-in-context rather than retrieval: at ~40–60 entries the knowledge fits
 * the prompt-cached system prompt cheaply, and retrieval would only add a failure mode (the right
 * entry not found). Past ~40k tokens, add a search tool over these same entries.
 */

export type KnowledgeStatus = 'shipped' | 'coming' | 'not_offered'

export interface KnowledgeEntry {
  id: string
  topic: string
  /** shipped = works today · coming = say it is coming, NEVER that it works today · not_offered = say it isn't offered. */
  status: KnowledgeStatus
  /** What the agent may say — plain, operator-facing, no hype. */
  say: string
  /** Specific claims the agent must not make about this topic. */
  neverClaim?: string[]
  /** Every number `say` states — joins the eval's allow-list of figures the agent may quote. */
  figures?: number[]
  /** Where it was verified (code paths, tracks). Not shown to the model. */
  sources: string[]
}

const STATUS_LABEL: Record<KnowledgeStatus, string> = {
  shipped: 'AVAILABLE TODAY',
  coming: 'COMING — not available yet; say it is coming, never that it works today',
  not_offered: 'NOT OFFERED — say so plainly',
}

export function renderKnowledge(entries: readonly KnowledgeEntry[]): string {
  return entries
    .map((e) => {
      const lines = [`### ${e.topic} [${STATUS_LABEL[e.status]}]`, e.say]
      if (e.neverClaim?.length) lines.push(`Never claim: ${e.neverClaim.join('; ')}.`)
      return lines.join('\n')
    })
    .join('\n\n')
}

/** Numbers stated in a text (years, prices, percentages, counts). */
export function numbersIn(text: string): number[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(',', '.')))
}

/** Contract checks, run by the test suite: a broken entry must fail the build, not mislead a prospect. */
export function knowledgeProblems(entries: readonly KnowledgeEntry[]): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const e of entries) {
    if (ids.has(e.id)) problems.push(`${e.id}: duplicate id`)
    ids.add(e.id)
    if (!e.sources.length) problems.push(`${e.id}: no source — every entry must cite where it was verified`)
    if (/\[FOUNDER|TODO|TBD|XX|lorem/i.test(e.say)) problems.push(`${e.id}: placeholder text`)
    const declared = new Set(e.figures ?? [])
    for (const n of numbersIn(e.say)) if (!declared.has(n)) problems.push(`${e.id}: states ${n} but does not declare it in figures`)
    if (e.status === 'coming' && /\b(today|now available|already|is live|currently (?:submits|sends))\b/i.test(e.say)) {
      problems.push(`${e.id}: a 'coming' entry must not read as available today`)
    }
  }
  return problems
}
