/**
 * The assistant's how-to knowledge (track 030 S2): markdown files under `knowledge/`, written from the
 * actual partner code. Each `## Title {#topic-id}` heading is one topic; `explain_feature` returns the
 * section, and the system prompt carries only the index (title + id) so the large text stays out of
 * every turn.
 *
 * Read from disk (not bundled): `next.config.mjs` lists `lib/assistant/knowledge/**` under
 * `outputFileTracingIncludes` for `/api/assistant` so the files ship with the serverless function.
 */
import fs from 'node:fs'
import path from 'node:path'

const FILES = ['inventory.md', 'schematic.md', 'site-tabs.md'] as const

export interface KnowledgeTopic {
  id: string
  title: string
  file: string
  body: string
}

let cache: KnowledgeTopic[] | null = null

function knowledgeDir(): string {
  const candidates = [
    path.join(process.cwd(), 'lib', 'assistant', 'knowledge'),
    path.join(process.cwd(), 'apps', 'partner', 'lib', 'assistant', 'knowledge'),
  ]
  const found = candidates.find((dir) => fs.existsSync(path.join(dir, FILES[0])))
  if (!found) throw new Error('assistant knowledge directory not found')
  return found
}

/** Pure: split one markdown document into topics. Text before the first `##` heading is dropped. */
export function parseKnowledge(markdown: string, file: string): KnowledgeTopic[] {
  const topics: KnowledgeTopic[] = []
  const parts = markdown.split(/^## /m).slice(1)
  for (const part of parts) {
    const newline = part.indexOf('\n')
    const heading = (newline === -1 ? part : part.slice(0, newline)).trim()
    const match = /^(.*?)\s*\{#([a-z0-9-]+)\}$/.exec(heading)
    if (!match) continue
    topics.push({
      id: match[2]!,
      title: match[1]!.trim(),
      file,
      body: (newline === -1 ? '' : part.slice(newline + 1)).trim(),
    })
  }
  return topics
}

export function knowledgeTopics(): KnowledgeTopic[] {
  if (cache) return cache
  const dir = knowledgeDir()
  const all = FILES.flatMap((file) => parseKnowledge(fs.readFileSync(path.join(dir, file), 'utf8'), file))
  const seen = new Set<string>()
  for (const t of all) {
    if (seen.has(t.id)) throw new Error(`duplicate assistant knowledge topic: ${t.id}`)
    seen.add(t.id)
  }
  cache = all
  return all
}

export function knowledgeTopicIds(): string[] {
  return knowledgeTopics().map((t) => t.id)
}

export function getKnowledgeTopic(id: string): KnowledgeTopic | null {
  return knowledgeTopics().find((t) => t.id === id) ?? null
}

/** `id: title` lines for the system prompt. */
export function knowledgeIndex(): string {
  return knowledgeTopics()
    .map((t) => `- ${t.id}: ${t.title}`)
    .join('\n')
}
