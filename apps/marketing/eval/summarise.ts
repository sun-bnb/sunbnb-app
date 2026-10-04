/**
 * Re-print the summary and failures of a saved eval run:  node eval/summarise.ts [results/file.json]
 * (defaults to the newest file in eval/results).
 */
import { readdirSync, readFileSync } from 'node:fs'

const dir = new URL('./results/', import.meta.url)
const file = process.argv[2] ?? new URL(readdirSync(dir).filter((f) => f.endsWith('.json')).sort().at(-1)!, dir).pathname
const { records, reasoning } = JSON.parse(readFileSync(file, 'utf8')) as {
  reasoning?: string
  records: { model: string; scenario: string; passed: boolean; failures: string[]; firstTokenMs: number[]; totalMs: number[] }[]
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : NaN
}
const p90 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.9)] ?? NaN

console.log(`${file}  (reasoning: ${reasoning ?? 'default'})\n`)
for (const model of [...new Set(records.map((r) => r.model))]) {
  const rs = records.filter((r) => r.model === model)
  const ttft = rs.flatMap((r) => r.firstTokenMs)
  const calls = rs.flatMap((r) => r.totalMs)
  console.log(
    `${model}: ${rs.filter((r) => r.passed).length}/${rs.length} passed · TTFT median ${(median(ttft) / 1000).toFixed(2)}s p90 ${(p90(ttft) / 1000).toFixed(2)}s · call median ${(median(calls) / 1000).toFixed(2)}s p90 ${(p90(calls) / 1000).toFixed(2)}s`,
  )
  for (const r of rs.filter((r) => !r.passed)) console.log(`   ✗ ${r.scenario} — ${r.failures.join('; ')}`)
}
