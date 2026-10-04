/**
 * Lead-agent eval runner (track 027, P0).
 *
 *   node eval/run.ts --models qwen3:14b,claude-haiku-4-5,claude-opus-5-5 [--scenario pricing-en] [--repeat 2]
 *     [--reasoning none|low|medium|high]   local models: thinking budget (default none)
 *     [--effort low|medium|high]           Claude 5.x models: effort (default low — chat latency)
 *
 * claude-* models need ANTHROPIC_API_KEY (apps/marketing/.env.local).
 *
 * Defaults to the local Ollama OpenAI-compatible endpoint. Prints a per-model summary and writes
 * the full transcripts to eval/results/<timestamp>.json (gitignored) for reading failures.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createClaudeModel } from '../lib/agent/claude-model.ts'
import { createOpenAICompatibleModel, type ChatMessage, type LeadAgentModel } from '../lib/agent/model.ts'
import { runTurn, type LeadState } from '../lib/agent/run-turn.ts'
import { buildSystemPrompt } from '../lib/agent/system-prompt.ts'
import { DEFAULT_MOCKUP, SCENARIOS, type Scenario } from './scenarios.ts'
import { scoreTranscript, type Transcript } from './scorers.ts'

const { values } = parseArgs({
  options: {
    models: { type: 'string', default: 'qwen3:14b' },
    scenario: { type: 'string' },
    repeat: { type: 'string', default: '1' },
    reasoning: { type: 'string', default: 'none' },
    effort: { type: 'string' },
    'base-url': { type: 'string', default: process.env.LEAD_AGENT_BASE_URL ?? 'http://localhost:11434/v1' },
  },
})

interface RunRecord {
  model: string
  scenario: string
  attempt: number
  passed: boolean
  failures: string[]
  transcript: Transcript
  firstTokenMs: number[]
  totalMs: number[]
  error?: string
}

async function runScenario(model: LeadAgentModel, scenario: Scenario): Promise<Omit<RunRecord, 'model' | 'scenario' | 'attempt'>> {
  const mockup = scenario.mockup ?? DEFAULT_MOCKUP
  const history: ChatMessage[] = [{ role: 'system', content: buildSystemPrompt(mockup) }]
  let lead: LeadState = { mockupSunbedCount: mockup.sunbedCount }
  const transcript: Transcript = { userMessages: [], replies: [], toolEvents: [], lead, exhaustedTurns: 0 }
  const firstTokenMs: number[] = []
  const totalMs: number[] = []

  for (const userMessage of scenario.turns) {
    history.push({ role: 'user', content: userMessage })
    transcript.userMessages.push(userMessage)
    // Same setting as the live /api/chat route.
    const turn = await runTurn(model, history, lead, { autoCapture: true })
    history.push(...turn.messages)
    lead = turn.lead
    transcript.replies.push(turn.reply)
    transcript.toolEvents.push(...turn.toolEvents)
    if (turn.exhausted) transcript.exhaustedTurns++
    for (const t of turn.modelCalls) {
      if (t.firstTokenMs !== null) firstTokenMs.push(t.firstTokenMs)
      totalMs.push(t.totalMs)
    }
  }
  transcript.lead = lead
  const failures = scoreTranscript(scenario.checks, transcript)
  return { passed: failures.length === 0, failures, transcript, firstTokenMs, totalMs }
}

function median(xs: number[]): number {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

async function main() {
  const models = values.models!.split(',').map((m) => m.trim()).filter(Boolean)
  const scenarios = values.scenario ? SCENARIOS.filter((s) => s.id === values.scenario) : SCENARIOS
  if (!scenarios.length) throw new Error(`no scenario with id ${values.scenario}`)
  const repeat = Math.max(1, Number(values.repeat))
  const records: RunRecord[] = []

  for (const modelName of models) {
    // claude-* → the Anthropic API (live path); anything else → the local OpenAI-compatible server.
    const model = modelName.startsWith('claude-')
      ? createClaudeModel({ model: modelName, effort: (values.effort ?? 'low') as 'low' | 'medium' | 'high' })
      : createOpenAICompatibleModel({
          baseUrl: values['base-url']!,
          model: modelName,
          reasoningEffort: values.reasoning as 'none' | 'low' | 'medium' | 'high',
        })
    console.log(`\n▶ ${modelName}`)
    for (const scenario of scenarios) {
      for (let attempt = 1; attempt <= repeat; attempt++) {
        try {
          const r = await runScenario(model, scenario)
          records.push({ model: modelName, scenario: scenario.id, attempt, ...r })
          console.log(`  ${r.passed ? '✓' : '✗'} ${scenario.id}${r.passed ? '' : ` — ${r.failures.join('; ')}`}`)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          records.push({
            model: modelName, scenario: scenario.id, attempt, passed: false, failures: [message],
            transcript: { userMessages: scenario.turns, replies: [], toolEvents: [], lead: {}, exhaustedTurns: 0 },
            firstTokenMs: [], totalMs: [], error: message,
          })
          console.log(`  ✗ ${scenario.id} — ERROR ${message}`)
        }
      }
    }
  }

  console.log('\nmodel                          pass        median TTFT   median call')
  for (const modelName of models) {
    const rs = records.filter((r) => r.model === modelName)
    const passed = rs.filter((r) => r.passed).length
    const ttft = median(rs.flatMap((r) => r.firstTokenMs))
    const call = median(rs.flatMap((r) => r.totalMs))
    console.log(
      `${modelName.padEnd(30)} ${`${passed}/${rs.length}`.padEnd(11)} ${`${(ttft / 1000).toFixed(2)}s`.padEnd(13)} ${(call / 1000).toFixed(2)}s`,
    )
  }

  mkdirSync(new URL('./results/', import.meta.url), { recursive: true })
  const file = new URL(`./results/${new Date().toISOString().replace(/[:.]/g, '-')}.json`, import.meta.url)
  writeFileSync(file, JSON.stringify({ models, baseUrl: values['base-url'], reasoning: values.reasoning, records }, null, 2))
  console.log(`\nfull transcripts: ${file.pathname}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
