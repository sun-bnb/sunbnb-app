#!/usr/bin/env node
/**
 * coverage-ratchet.mjs — per-file coverage ratchet for apps/partner.
 *
 * Part of the partner test-architecture spine (.claude/tracks/004). The
 * coverage-contract guarantees every gated export is registered + auth-tested;
 * this guards the *other* erosion vector: a touched source file silently losing
 * line coverage (e.g. new code added without tests). A file's line% may not drop
 * below its committed baseline.
 *
 * Modes:
 *   node scripts/coverage-ratchet.mjs            # CHECK touched files vs baseline (exit 1 on a drop)
 *   node scripts/coverage-ratchet.mjs --update   # REGENERATE the baseline from current coverage
 *
 * Reads coverage from apps/partner/coverage/coverage-summary.json (the
 * `json-summary` reporter — run `npm run test:coverage` in apps/partner first;
 * the npm scripts do this for you). Baseline lives at
 * apps/partner/coverage-baseline.json (committed).
 *
 * "Touched" = files changed in BASE...HEAD (BASE env, default origin/main) PLUS
 * any staged/unstaged working changes — so it catches a regression locally
 * before commit and in the promote gate (BASE=origin/test). A NEW file (no
 * baseline entry) is skipped: the coverage-contract already forces new exports
 * to be tested. To intentionally lower a file's coverage, run --update + commit.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SUMMARY = join(REPO_ROOT, 'apps/partner/coverage/coverage-summary.json')
const BASELINE = join(REPO_ROOT, 'apps/partner/coverage-baseline.json')
const EPSILON = 0.01 // ignore sub-0.01% float noise
const SRC_RE = /^apps\/partner\/(app|lib)\/.+\.tsx?$/
const SKIP_RE = /\.test\.tsx?$|\.integration\.test\.tsx?$|\/__mocks__\//

function die(msg) {
  console.error(`coverage-ratchet: ${msg}`)
  process.exit(1)
}

function loadSummary() {
  if (!existsSync(SUMMARY)) {
    die(`no coverage summary at ${relative(REPO_ROOT, SUMMARY)} — run the partner test:coverage first.`)
  }
  const raw = JSON.parse(readFileSync(SUMMARY, 'utf8'))
  // Re-key absolute paths → repo-relative; keep only line%.
  const byFile = {}
  for (const [abs, metrics] of Object.entries(raw)) {
    if (abs === 'total') continue
    const rel = relative(REPO_ROOT, abs)
    if (typeof metrics?.lines?.pct === 'number') byFile[rel] = metrics.lines.pct
  }
  return byFile
}

function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

function touchedFiles() {
  const base = process.env.BASE || 'origin/main'
  const sets = [
    git(`diff --name-only ${base}...HEAD`),
    git('diff --name-only HEAD'), // unstaged
    git('diff --name-only --cached'), // staged
  ]
  const files = new Set()
  for (const block of sets) {
    for (const line of block.split('\n')) {
      const f = line.trim()
      if (f && SRC_RE.test(f) && !SKIP_RE.test(f)) files.add(f)
    }
  }
  return [...files].sort()
}

// ── --update: regenerate the baseline ───────────────────────────────────────
if (process.argv.includes('--update')) {
  const summary = loadSummary()
  const sorted = Object.fromEntries(
    Object.entries(summary)
      .filter(([rel]) => SRC_RE.test(rel) && !SKIP_RE.test(rel))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([rel, pct]) => [rel, Number(pct.toFixed(2))]),
  )
  writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + '\n')
  console.log(`coverage-ratchet: baseline updated — ${Object.keys(sorted).length} partner source files → ${relative(REPO_ROOT, BASELINE)}`)
  process.exit(0)
}

// ── default: check touched files vs baseline ─────────────────────────────────
if (!existsSync(BASELINE)) {
  die(`no baseline at ${relative(REPO_ROOT, BASELINE)} — run \`npm run coverage:baseline\` and commit it first.`)
}
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
const summary = loadSummary()
const touched = touchedFiles()

const drops = []
const newFiles = []
let checked = 0
for (const file of touched) {
  if (!(file in baseline)) {
    if (file in summary) newFiles.push(file)
    continue // new file — coverage-contract covers new-export testing
  }
  if (!(file in summary)) continue // deleted / no executable coverage this run
  checked++
  const before = baseline[file]
  const now = summary[file]
  if (now < before - EPSILON) drops.push({ file, before, now })
}

if (newFiles.length) {
  console.log(`coverage-ratchet: ${newFiles.length} new touched file(s) with no baseline (skipped; add via coverage:baseline):`)
  for (const f of newFiles) console.log(`  + ${f}  (${summary[f].toFixed(2)}%)`)
}

if (drops.length) {
  console.error(`\n✗ coverage-ratchet: ${drops.length} touched file(s) dropped below baseline:\n`)
  for (const d of drops) {
    console.error(`  ${d.file}\n      baseline ${d.before.toFixed(2)}%  →  now ${d.now.toFixed(2)}%  (−${(d.before - d.now).toFixed(2)})`)
  }
  console.error(`\nAdd tests to restore coverage, or — if the drop is intentional — run`)
  console.error(`  npm run coverage:baseline   and commit apps/partner/coverage-baseline.json\n`)
  process.exit(1)
}

console.log(`✓ coverage-ratchet: ${checked} touched partner file(s) checked, no coverage drops (BASE=${process.env.BASE || 'origin/main'}).`)
process.exit(0)
