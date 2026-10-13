#!/usr/bin/env node
// context-health.mjs — ONE mechanical health signal for every AI-context layer.
// No LLM. No DB unless --with-store. Target: < 1 s. Always exits 0 (nag, never block).
//
//   node .claude/scripts/context-health.mjs                 # grouped report + fix commands
//   node .claude/scripts/context-health.mjs --summary       # one line (SessionStart hook, pre-push)
//   node .claude/scripts/context-health.mjs --json          # machine-readable findings + metrics
//   node .claude/scripts/context-health.mjs --scope wiki    # wiki|canonical|playbooks|tracks|agents|all
//   node .claude/scripts/context-health.mjs --with-store    # add knowledge-store checks (needs Docker pg)
//   node .claude/scripts/context-health.mjs --snapshot      # append metrics to .claude/context/health-history.jsonl
//
// Budgets live in .claude/context/budgets.json (shared with /update-knowledge and the specs).
// Superseded detect-drift.mjs (kept as a shim for one release).
//
// Severity: BROKEN = a claim that is false now (missing file/symbol, hard cap, bad vocabulary);
//           WARN   = drift that will mislead soon (stale, over soft budget, unindexed, unresolved);
//           INFO   = housekeeping (report only).

import { readFileSync, readdirSync, statSync, existsSync, appendFileSync } from 'fs';
import { join, relative } from 'path';
import { execSync } from 'child_process';
import { render as renderTracksIndex, loadTracks } from './tracks-index.mjs';
import { applyNav } from './playbook-index.mjs';

const REPO_ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const BUDGETS = JSON.parse(readFileSync(join(REPO_ROOT, '.claude/context/budgets.json'), 'utf8'));
const TODAY = new Date();
const DAY = 86_400_000;

// ---- CLI ----
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
let scope = 'all';
const si = args.findIndex((a) => a === '--scope');
if (si !== -1 && args[si + 1]) scope = args[si + 1];
const se = args.find((a) => a.startsWith('--scope='));
if (se) scope = se.split('=')[1];
const SCOPES = ['wiki', 'canonical', 'playbooks', 'tracks', 'agents'];
if (scope !== 'all' && !SCOPES.includes(scope)) {
  console.error(`Unknown scope: ${scope}. Use --scope ${SCOPES.join('|')}|all`);
  process.exit(2);
}
const scopes = scope === 'all' ? SCOPES : [scope];

// ---- helpers ----
const findings = [];
const add = (layer, page, severity, message, fix = null) => findings.push({ layer, page, severity, message, fix });
const rel = (p) => relative(REPO_ROOT, p);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const daysSince = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? Math.floor((TODAY - t) / DAY) : null; };

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { if (entry !== 'node_modules') walk(full, files); }
    else if (entry.endsWith('.md')) files.push(full);
  }
  return files;
}
function splitFm(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  return m ? { fm: m[1], body: m[2] } : { fm: null, body: content };
}
function fmValue(fm, key) {
  const m = (fm || '').match(new RegExp(`^${key}:\\s*(.*?)\\s*$`, 'm'));
  return m ? m[1].replace(/\s+#.*$/, '').trim() : null;
}
function fmList(fm, key) {
  const m = (fm || '').match(new RegExp(`^${key}:\\s*\\n((?:\\s+-\\s+.+\\n?)+)`, 'm'));
  if (!m) return [];
  return m[1].split('\n').map((l) => l.match(/^\s+-\s+(.+?)\s*$/)).filter(Boolean).map((x) => x[1]).filter((v) => !/[<>]/.test(v));
}
const stripFences = (t) => t.replace(/```[\s\S]*?```/g, '');
const PATH_PREFIX_RE = /^(apps|packages|\.claude|prisma|e2e)\//;
function extractInlineRefs(body) {
  const refs = [];
  const re = /`([\w./\[\]-]+\.(?:ts|tsx|prisma|sql|mjs|js|md|json))(?:#([\w-]+)|:(\d+))?`/g;
  let m;
  while ((m = re.exec(body))) {
    if (!PATH_PREFIX_RE.test(m[1])) continue;
    refs.push({ path: m[1], symbol: m[2] || null, line: m[3] || null });
  }
  return refs;
}
const extractCrossRefs = (t) => [...t.matchAll(/\[\[([a-z]+):([a-z0-9-]+)\]\]/g)].map((m) => ({ type: m[1], slug: m[2] }));
const fileExistsRel = (p) => existsSync(join(REPO_ROOT, p.split('#')[0].split(':')[0]));
function symbolFoundInFile(relPath, symbol) {
  const full = join(REPO_ROOT, relPath.split('#')[0].split(':')[0]);
  if (!existsSync(full)) return false;
  const content = readFileSync(full, 'utf8');
  const prefixed = symbol.match(/^(model|enum|interface|type|class|function)-(.+)$/);
  if (prefixed) return new RegExp(`\\b${prefixed[1]}\\s+${prefixed[2]}\\b`).test(content);
  return [
    `\\bfunction\\s+${symbol}\\b`, `\\bconst\\s+${symbol}\\b`, `\\blet\\s+${symbol}\\b`, `\\bclass\\s+${symbol}\\b`,
    `\\bmodel\\s+${symbol}\\b`, `\\benum\\s+${symbol}\\b`, `\\binterface\\s+${symbol}\\b`, `\\btype\\s+${symbol}\\b`,
    `\\bexport\\s+(?:default\\s+)?(?:async\\s+)?(?:function|const|let|class)\\s+${symbol}\\b`,
  ].some((p) => new RegExp(p).test(content));
}
function checkRefs(layer, pageRel, scannable) {
  for (const ref of extractInlineRefs(scannable)) {
    if (!fileExistsRel(ref.path)) add(layer, pageRel, 'BROKEN', `inline ref: ${ref.path} (file missing)`);
    else if (ref.symbol && !ref.path.endsWith('.md') && !symbolFoundInFile(ref.path, ref.symbol)) add(layer, pageRel, 'WARN', `inline ref: ${ref.path}#${ref.symbol} (symbol not found — heuristic)`);
  }
}

// Last commit date per file under a prefix, in ONE git call; dirty files count as today.
function lastTouched(prefix) {
  const map = new Map();
  try {
    const out = execSync(`git log --format='%x00%cs' --name-only -- ${prefix}`, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    let date = null;
    for (const line of out.split('\n')) {
      if (line.startsWith('\0')) { date = line.slice(1).trim(); continue; }
      const f = line.trim();
      if (f && !map.has(f)) map.set(f, date);
    }
    const dirty = execSync(`git status --porcelain -- ${prefix}`, { cwd: REPO_ROOT, encoding: 'utf8' });
    for (const line of dirty.split('\n')) {
      const f = line.slice(3).trim();
      if (f) map.set(f, TODAY.toISOString().slice(0, 10));
    }
  } catch { /* not a git checkout — skip freshness checks */ }
  return map;
}

// ---- Wiki slug + track catalogs (cross-refs from any layer resolve against these) ----
const DIR_TO_TYPE = { entities: 'entity', flows: 'flow', subsystems: 'subsystem', workflows: 'workflow' };
const EXAMPLE_SLUGS = new Set(['baz', 'slug', 'name', 'foo', 'x', 'y', 'related-flow', 'related-entity', 'involved-subsystem', 'primary-entity', 'nnn-slug']);
const WIKI_DIR = join(REPO_ROOT, '.claude/wiki');
const TRACKS_DIR = join(REPO_ROOT, '.claude/tracks');
const wikiSlugs = new Set();
for (const p of walk(WIKI_DIR)) {
  const m = relative(WIKI_DIR, p).match(/^(\w+)\/([\w-]+)\.md$/);
  if (m && DIR_TO_TYPE[m[1]]) wikiSlugs.add(`${DIR_TO_TYPE[m[1]]}:${m[2]}`);
}
// context workflows also carry workflow: slugs
for (const p of walk(join(REPO_ROOT, '.claude/context/workflows'))) {
  const s = fmValue(splitFm(readFileSync(p, 'utf8')).fm, 'slug');
  if (s) wikiSlugs.add(`workflow:${s}`);
}
const plannedSlugs = new Set();
{
  const idx = join(WIKI_DIR, 'index.md');
  if (existsSync(idx)) {
    const planned = readFileSync(idx, 'utf8').match(/^##\s+Planned[\s\S]*?(?=^##\s|^---\s*$|(?![\s\S]))/m);
    if (planned) for (const m of planned[0].matchAll(/`([\w-]+)`/g)) plannedSlugs.add(m[1]);
  }
}
const trackIds = new Set();
if (existsSync(TRACKS_DIR)) for (const f of readdirSync(TRACKS_DIR)) { const m = f.match(/^(\d{3}-[\w-]+)\.md$/); if (m) trackIds.add(m[1]); }
function checkCrossRefs(layer, pageRel, text) {
  for (const xr of extractCrossRefs(text)) {
    if (EXAMPLE_SLUGS.has(xr.slug)) continue;
    if (xr.type === 'track') {
      if (![...trackIds].some((id) => id === xr.slug || id.startsWith(xr.slug + '-') || id.startsWith(xr.slug))) add(layer, pageRel, 'WARN', `unresolved track ref: [[track:${xr.slug}]]`);
      continue;
    }
    const key = `${xr.type}:${xr.slug}`;
    if (!wikiSlugs.has(key) && !plannedSlugs.has(xr.slug)) add(layer, pageRel, 'WARN', `unresolved cross-ref: [[${key}]] (no wiki page, not in Planned)`);
  }
}

const metrics = { generatedAt: TODAY.toISOString(), sha: null, canonical: {}, wiki: {}, playbooks: {}, tracks: {}, agents: {}, findings: {} };
try { metrics.sha = execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim(); } catch { /* ignore */ }

// =====================================================================================
// WIKI
// =====================================================================================
function checkWiki() {
  const B = BUDGETS.wiki;
  const touched = lastTouched('.claude/wiki .claude/context/workflows');
  let pages = 0, stale90 = 0, stableOk = 0;
  const contentPages = [...walk(WIKI_DIR), ...walk(join(REPO_ROOT, '.claude/context/workflows'))];
  for (const p of contentPages) {
    const pageRel = rel(p);
    const base = p.split('/').pop();
    const content = readFileSync(p, 'utf8');
    const { fm, body } = splitFm(content);
    const scannable = stripFences(body);
    const sub = relative(WIKI_DIR, p).split('/')[0];
    const isContent = !!DIR_TO_TYPE[sub] || pageRel.startsWith('.claude/context/workflows/');

    if (base === 'log.md') {
      const bad = [...body.matchAll(/^##\s+(.*)$/gm)].map((m) => m[1]).filter((h) => !/^\[\d{4}-\d{2}-\d{2}\]\s+[\w][\w -]*?\s*\|/.test(h) && !/^\[YYYY/.test(h));
      if (bad.length) add('wiki', pageRel, 'WARN', `${bad.length} log heading(s) not in '## [YYYY-MM-DD] op | summary' form: ${bad.slice(0, 3).map((h) => `"${h.slice(0, 40)}"`).join(', ')}`, 'reformat the headings (machine-parsed by /wiki suggest)');
      continue;
    }
    if (base === 'index.md' && sub === 'index.md') {
      const lines = content.split('\n').length;
      if (lines > B.indexMaxLines) add('wiki', pageRel, 'WARN', `index is ${lines} lines (max ${B.indexMaxLines} — the harness truncates)`, '/wiki review');
    }
    checkRefs('wiki', pageRel, scannable);
    checkCrossRefs('wiki', pageRel, scannable);
    if (!isContent) continue;

    pages++;
    const type = fmValue(fm, 'type');
    const status = fmValue(fm, 'status');
    const lastVerified = fmValue(fm, 'last_verified');
    for (const k of ['type', 'slug', 'status', 'last_verified']) if (!fmValue(fm, k)) add('wiki', pageRel, 'BROKEN', `frontmatter missing '${k}'`, 'add the field per .claude/wiki/README.md § Page conventions');
    if (status && !B.statusVocabulary.includes(status)) add('wiki', pageRel, 'BROKEN', `status '${status}' not in ${B.statusVocabulary.join('|')}`);
    for (const src of fmList(fm, 'sources')) {
      const clean = src.split('#')[0].split(':')[0];
      if (!fileExistsRel(clean)) add('wiki', pageRel, 'BROKEN', `source missing: ${src}`, `/wiki ingest ${pageRel.replace('.claude/wiki/', '')}`);
      else if (src.includes('#') && !clean.endsWith('.md') && !symbolFoundInFile(clean, src.split('#')[1])) add('wiki', pageRel, 'WARN', `source symbol not found: ${src} (heuristic)`);
    }
    for (const key of ['sources', 'related']) {
      const n = fmList(fm, key).length;
      if (n > B.listMax[key]) add('wiki', pageRel, 'WARN', `${key}: has ${n} entries (max ${B.listMax[key]}) — scope too wide`, '/wiki review (split or drop uncited refs)');
    }
    const age = lastVerified ? daysSince(lastVerified) : null;
    if (age !== null) {
      if (age > B.staleAfterDays) { stale90++; add('wiki', pageRel, 'WARN', `last_verified ${age} d ago (> ${B.staleAfterDays})`, `/wiki lint ${pageRel.replace('.claude/wiki/', '')} — re-verify or mark stale`); }
      else if (status === 'stable' && age > B.stableMaxAgeDays) add('wiki', pageRel, 'WARN', `'stable' but last_verified ${age} d ago (> ${B.stableMaxAgeDays}) — re-verify or downgrade to draft`);
      else if (status === 'stable') stableOk++;
      const t = touched.get(pageRel);
      if (t && lastVerified && t > lastVerified) add('wiki', pageRel, 'WARN', `edited ${t} after last_verified ${lastVerified} — bump it or the page is lying`, 'bump last_verified only if you re-checked claims');
    }
    const lines = body.split('\n').length;
    const cap = B.lines[type];
    if (cap) {
      if (lines > cap.hard) add('wiki', pageRel, 'BROKEN', `${lines} lines > hard cap ${cap.hard} for ${type}`, '/wiki review (split)');
      else if (lines > cap.soft) add('wiki', pageRel, 'WARN', `${lines} lines > target ${cap.soft} for ${type}`);
    }
  }
  metrics.wiki = { pages, stale90, stableOk, staleRatio: pages ? +(stale90 / pages).toFixed(2) : 0 };
}

// =====================================================================================
// CANONICAL — CLAUDE.md tree + rules (+ AGENTS.md if present)
// =====================================================================================
function budgetFor(relPath) {
  const F = BUDGETS.canonical.files;
  if (F[relPath]) return F[relPath];
  for (const [pat, b] of Object.entries(F)) {
    if (!pat.includes('*')) continue;
    const re = new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+') + '$');
    if (re.test(relPath)) return b;
  }
  return null;
}
function canonicalFiles() {
  const files = [];
  for (const f of ['CLAUDE.md', 'AGENTS.md', 'PROJECT_CONTEXT.md']) if (existsSync(join(REPO_ROOT, f))) files.push(join(REPO_ROOT, f));
  for (const base of ['apps', 'packages']) {
    const dir = join(REPO_ROOT, base);
    if (!existsSync(dir)) continue;
    for (const sub of readdirSync(dir)) { const c = join(dir, sub, 'CLAUDE.md'); if (existsSync(c)) files.push(c); }
  }
  files.push(...walk(join(REPO_ROOT, '.claude/rules')));
  return files;
}
function checkCanonical() {
  const B = BUDGETS.canonical;
  let autoLoaded = 0;
  const sizes = {};
  for (const p of canonicalFiles()) {
    const pageRel = rel(p);
    const content = readFileSync(p, 'utf8');
    const bytes = Buffer.byteLength(content);
    sizes[pageRel] = bytes;
    if (pageRel === 'CLAUDE.md' || pageRel === 'AGENTS.md' || pageRel.startsWith('.claude/rules/')) autoLoaded += bytes;
    const budget = budgetFor(pageRel);
    if (budget) {
      if (bytes > budget.hard) add('canonical', pageRel, 'BROKEN', `${kb(bytes)} > hard cap ${kb(budget.hard)}`, `/update-knowledge ${pageRel} (move narrative to a pulled sibling or the wiki)`);
      else if (bytes > budget.soft) add('canonical', pageRel, 'WARN', `${kb(bytes)} > target ${kb(budget.soft)}`);
    }
    const longLines = content.split('\n').filter((l) => Buffer.byteLength(l) > B.lineBytes.hard).length;
    if (longLines) add('canonical', pageRel, 'WARN', `${longLines} line(s) > ${B.lineBytes.hard} B (table cells hide bytes from line budgets)`, 'reflow into short lines or move the cell out');
    const scannable = stripFences(content);
    checkRefs('canonical', pageRel, scannable);
    checkCrossRefs('canonical', pageRel, scannable);
  }
  // version claims in the root tech-stack table
  const root = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
  for (const c of B.versionClaims?.checks || []) {
    const m = root.match(new RegExp(c.label));
    if (!m) continue;
    const pj = join(REPO_ROOT, c.from);
    if (!existsSync(pj)) continue;
    const pkg = JSON.parse(readFileSync(pj, 'utf8'));
    const spec = (pkg.dependencies || {})[c.dep] || (pkg.devDependencies || {})[c.dep];
    const inst = spec && spec.match(/(\d+)/);
    if (inst && inst[1] !== m[1]) add('canonical', 'CLAUDE.md', 'WARN', `tech table says '${m[0]}' but ${c.from} has ${c.dep} ${spec}`, '/update-knowledge CLAUDE.md (fix the version claim)');
  }
  // workspaces without a CLAUDE.md
  const missing = [];
  for (const base of ['apps', 'packages']) {
    const dir = join(REPO_ROOT, base);
    if (!existsSync(dir)) continue;
    for (const sub of readdirSync(dir)) {
      const ws = `${base}/${sub}`;
      if (!existsSync(join(dir, sub, 'package.json')) || existsSync(join(dir, sub, 'CLAUDE.md'))) continue;
      if ((B.optionalWorkspaces || []).includes(ws)) continue;
      missing.push(ws);
    }
  }
  if (missing.length) add('canonical', 'CLAUDE.md', 'WARN', `workspaces without a CLAUDE.md: ${missing.join(', ')}`, 'add a pointer CLAUDE.md or list the workspace under budgets.canonical.optionalWorkspaces');
  metrics.canonical = { autoLoadedBytes: autoLoaded, sizes };
}

// =====================================================================================
// PLAYBOOKS — .claude/knowledge/<agent>.md
// =====================================================================================
function checkPlaybooks() {
  const B = BUDGETS.playbooks;
  const dir = join(REPO_ROOT, '.claude/knowledge');
  const per = {};
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md') || f === 'README.md') continue;
    const agent = f.replace(/\.md$/, '');
    const p = join(dir, f);
    const pageRel = rel(p);
    const content = readFileSync(p, 'utf8');
    const bytes = Buffer.byteLength(content);
    const entries = [...content.matchAll(/^###\s+(\d{4}-\d{2}-\d{2}):\s*(.+)$/gm)].map((m) => ({ date: m[1], title: m[2].trim() }));
    per[agent] = { bytes, entries: entries.length };
    const fix = `/groom ${agent}`;
    if (bytes > B.bytes.hard) add('playbooks', pageRel, 'BROKEN', `${kb(bytes)} > hard budget ${kb(B.bytes.hard)}`, fix);
    else if (bytes > B.bytes.soft) add('playbooks', pageRel, 'WARN', `${kb(bytes)} > soft budget ${kb(B.bytes.soft)}`, fix);
    if (entries.length > B.entries.hard) add('playbooks', pageRel, 'BROKEN', `${entries.length} entries > ${B.entries.hard}`, fix);
    else if (entries.length > B.entries.soft) add('playbooks', pageRel, 'WARN', `${entries.length} entries > ${B.entries.soft}`, fix);
    // duplicate ## sections
    const h2 = [...content.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
    const seen = new Set(); const dups = new Set();
    for (const h of h2) { if (seen.has(h)) dups.add(h); seen.add(h); }
    if (dups.size) add('playbooks', pageRel, 'WARN', `duplicate section heading(s): ${[...dups].map((d) => `"${d}"`).join(', ')}`, fix);
    // entries written as ## instead of ### (escape the entry format)
    const h2Dated = h2.filter((h) => /\(\d{4}-\d{2}-\d{2}\)|\d{4}-\d{2}-\d{2}/.test(h));
    if (h2Dated.length) add('playbooks', pageRel, 'WARN', `${h2Dated.length} dated '##' heading(s) — entries must be '### YYYY-MM-DD: title' under a theme section`, fix);
    // navigation index coverage
    const nav = content.match(/^##\s+Navigation index\s*$([\s\S]*?)(?=^##\s)/m);
    const navText = nav ? nav[1] : '';
    if (!nav) add('playbooks', pageRel, 'WARN', 'no "## Navigation index" section', fix);
    else {
      const v2 = /<!--\s*nav:begin/.test(navText);
      if (v2) {
        // v2: the block is generated — it must equal what playbook-index.mjs would write
        if (applyNav(content) !== content) add('playbooks', pageRel, 'WARN', 'navigation index block is out of date', `node .claude/scripts/playbook-index.mjs ${agent}`);
        const untagged = [...content.matchAll(/^###\s+\d{4}-\d{2}-\d{2}:.*\n(?!tags:)/gm)].length;
        if (untagged) add('playbooks', pageRel, 'WARN', `${untagged} entr${untagged === 1 ? 'y' : 'ies'} without a 'tags:' line (v2 format)`, fix);
      } else {
        add('playbooks', pageRel, 'WARN', 'navigation index is hand-written (v1) — migrate to the generated block', `/groom ${agent} (or: node .claude/scripts/playbook-index.mjs ${agent})`);
        const unindexed = entries.filter((e) => !navText.includes(e.title.replace(/[`*_]/g, '').slice(0, 40)) && !navText.includes(e.title.slice(0, 40)));
        if (unindexed.length) add('playbooks', pageRel, 'WARN', `${unindexed.length} entr${unindexed.length === 1 ? 'y' : 'ies'} missing from the navigation index: ${unindexed.slice(0, 3).map((e) => `"${e.title.slice(0, 40)}"`).join(', ')}${unindexed.length > 3 ? ', …' : ''}`, fix);
        if (entries.length && /\(Empty\s*—/.test(navText)) add('playbooks', pageRel, 'INFO', 'navigation index still carries the "(Empty — …)" placeholder', fix);
      }
    }
    checkRefs('playbooks', pageRel, stripFences(content));
    checkCrossRefs('playbooks', pageRel, stripFences(content));
  }
  metrics.playbooks = per;
}

// =====================================================================================
// TRACKS — frontmatter truth + derived registry
// =====================================================================================
function checkTracks() {
  const B = BUDGETS.tracks;
  const { tracks, subdocs, orphans } = loadTracks(REPO_ROOT);
  const byStatus = {};
  for (const t of tracks) {
    const pageRel = `.claude/tracks/${t.file}`;
    const fm = t.fm;
    for (const k of ['id', 'title', 'status', 'created', 'updated']) if (!fm[k]) add('tracks', pageRel, 'BROKEN', `frontmatter missing '${k}'`, 'see .claude/tracks/README.md § Anatomy');
    if (fm.id && `${fm.id}.md` !== t.file) add('tracks', pageRel, 'BROKEN', `frontmatter id '${fm.id}' ≠ filename`);
    const status = (fm.status || '').toLowerCase();
    byStatus[status] = (byStatus[status] || 0) + 1;
    if (status && !B.statusVocabulary.includes(status)) add('tracks', pageRel, 'BROKEN', `status '${status}' not in ${B.statusVocabulary.join('|')}`, 'fix the frontmatter, then: node .claude/scripts/tracks-index.mjs');
    if (/^\*\*Status:\*\*/m.test(t.body) && !fm.status) add('tracks', pageRel, 'BROKEN', 'status lives in the body, not in frontmatter');
    const age = fm.updated ? daysSince(fm.updated) : null;
    if (status === 'active' && age !== null && age > B.activeStaleDays) add('tracks', pageRel, 'WARN', `active but updated ${age} d ago (> ${B.activeStaleDays})`, 'run handoff (rewrite Resume here) or set status: paused/done');
    if (!/^##\s+Resume here/m.test(t.body)) add('tracks', pageRel, 'BROKEN', 'no "## Resume here" section (the cold-start contract)');
    const scannable = stripFences(t.body);
    checkCrossRefs('tracks', pageRel, scannable);
  }
  for (const o of orphans) add('tracks', `.claude/tracks/${o}`, 'WARN', 'neither a track (no id:) nor a sub-document (no parent:)', 'add frontmatter `parent: NNN-slug` (sub-document) or fold into its track and delete');
  for (const s of subdocs) if (!trackIds.has(s.parent)) add('tracks', `.claude/tracks/${s.file}`, 'BROKEN', `parent '${s.parent}' is not a track`);
  const indexPath = join(TRACKS_DIR, 'index.md');
  const current = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
  if (current !== renderTracksIndex(REPO_ROOT, { nextActionMaxChars: B.nextActionMaxChars })) add('tracks', '.claude/tracks/index.md', 'WARN', 'registry differs from the tracks\' frontmatter / Resume-here', 'node .claude/scripts/tracks-index.mjs');
  metrics.tracks = { count: tracks.length, byStatus, subdocs: subdocs.length, orphans: orphans.length };
}

// =====================================================================================
// AGENTS + COMMANDS — definitions that steer every dispatch
// =====================================================================================
function checkAgents() {
  const B = BUDGETS.agents;
  const turns = {};
  for (const p of walk(join(REPO_ROOT, '.claude/agents'))) {
    const pageRel = rel(p);
    const content = readFileSync(p, 'utf8');
    const { fm, body } = splitFm(content);
    if (!fm) { add('agents', pageRel, 'BROKEN', 'no frontmatter'); continue; }
    for (const k of ['name', 'description']) if (!fmValue(fm, k)) add('agents', pageRel, 'BROKEN', `frontmatter missing '${k}'`);
    const mt = fmValue(fm, 'maxTurns');
    if (mt) turns[pageRel] = Number(mt);
    checkRefs('agents', pageRel, stripFences(body));
    checkCrossRefs('agents', pageRel, stripFences(body));
  }
  const off = Object.entries(turns).filter(([, v]) => v !== B.maxTurns);
  if (off.length) add('agents', '.claude/agents', 'WARN', `maxTurns ≠ ${B.maxTurns}: ${off.map(([p, v]) => `${p.split('/').pop()}=${v}`).join(', ')}`, 'align with budgets.agents.maxTurns (see memory: size packets under maxTurns)');
  const noFm = [];
  for (const p of walk(join(REPO_ROOT, '.claude/commands'))) {
    const content = readFileSync(p, 'utf8');
    if (!splitFm(content).fm) noFm.push(p.split('/').pop());
    checkRefs('agents', rel(p), stripFences(content));
  }
  if (noFm.length) add('agents', '.claude/commands', 'WARN', `commands without frontmatter (description/argument-hint): ${noFm.join(', ')}`, 'add a frontmatter block');
  metrics.agents = { maxTurns: turns, commandsWithoutFrontmatter: noFm.length };
}

// =====================================================================================
// STORE — opt-in; needs the knowledge Postgres
// =====================================================================================
async function checkStore() {
  try {
    const { loadConfig } = await import('./knowledge-ingest.mjs');
    const pg = (await import('pg')).default;
    const cfg = loadConfig();
    const client = new pg.Client({ connectionString: cfg.dbUrl, connectionTimeoutMillis: 2000 });
    await client.connect();
    try {
      const q = async (sql) => (await client.query(sql)).rows;
      const [{ total, raw, verified, promoted, unembedded }] = await q(`SELECT count(*)::int total, count(*) FILTER (WHERE status='raw')::int raw, count(*) FILTER (WHERE status='verified')::int verified, count(*) FILTER (WHERE status='promoted')::int promoted, count(*) FILTER (WHERE embedding IS NULL)::int unembedded FROM knowledge_record`);
      const [{ dupes }] = await q(`SELECT count(*)::int dupes FROM (SELECT lower(text) t FROM knowledge_record GROUP BY 1 HAVING count(*) > 1) d`);
      const [{ badtypes }] = await q(`SELECT count(*)::int badtypes FROM knowledge_record WHERE type NOT IN ('decision','incident','gotcha','dead-end','observation')`);
      const [{ empty30 }] = await q(`SELECT count(*)::int empty30 FROM ingested_session WHERE record_count = 0 AND ingested_at > now() - interval '30 days'`);
      const [{ last }] = await q(`SELECT max(ingested_at)::date::text last FROM ingested_session`);
      const bySource = await q(`SELECT source, count(*)::int n FROM knowledge_record GROUP BY 1 ORDER BY 2 DESC`);
      metrics.store = { total, raw, verified, promoted, unembedded, dupes, badtypes, empty30, lastIngest: last, bySource: Object.fromEntries(bySource.map((r) => [r.source, r.n])) };
      if (unembedded) add('store', 'knowledge_record', 'WARN', `${unembedded} records without embedding`, 'node .claude/scripts/knowledge-ingest.mjs --embed-pending');
      if (dupes) add('store', 'knowledge_record', 'INFO', `${dupes} exact-duplicate texts`, 'node .claude/scripts/knowledge-recall.mjs --candidates (groom)');
      if (badtypes) add('store', 'knowledge_record', 'WARN', `${badtypes} records with a type outside the kb: vocabulary`, 'knowledge-ingest validates types on insert from P2 onward; reclassify or delete');
      if (verified + promoted === 0 && total > 0) add('store', 'knowledge_record', 'WARN', `${total} records, none verified/promoted — the credit→promotion loop has never run`, 'agents: knowledge-recall.mjs --credit <id>; /groom <agent>');
      if (last && daysSince(last) > 7) add('store', 'ingested_session', 'WARN', `last ingest ${daysSince(last)} d ago — SessionEnd hook may be unwired`, 'check .claude/settings.json hooks + Docker');
    } finally { await client.end(); }
  } catch (e) {
    add('store', 'knowledge_record', 'INFO', `store unreachable (${(e.message || '').split('\n')[0].slice(0, 80)})`, 'docker start sunbnb-knowledge-postgres');
  }
}

// ---- run ----
if (scopes.includes('wiki')) checkWiki();
if (scopes.includes('canonical')) checkCanonical();
if (scopes.includes('playbooks')) checkPlaybooks();
if (scopes.includes('tracks')) checkTracks();
if (scopes.includes('agents')) checkAgents();
if (flag('with-store')) await checkStore();

const count = (sev) => findings.filter((f) => f.severity === sev).length;
metrics.findings = { broken: count('BROKEN'), warn: count('WARN'), info: count('INFO') };
const byLayer = new Map();
for (const f of findings) { if (!byLayer.has(f.layer)) byLayer.set(f.layer, []); byLayer.get(f.layer).push(f); }

// ---- output ----
if (flag('snapshot')) {
  const histPath = join(REPO_ROOT, '.claude/context/health-history.jsonl');
  const row = { date: TODAY.toISOString().slice(0, 10), sha: metrics.sha, findings: metrics.findings,
    autoLoadedBytes: metrics.canonical.autoLoadedBytes, canonical: metrics.canonical.sizes, playbooks: metrics.playbooks,
    wiki: metrics.wiki, tracks: metrics.tracks, store: metrics.store || null };
  appendFileSync(histPath, JSON.stringify(row) + '\n');
  console.log(`context-health: snapshot appended to ${rel(histPath)}`);
}

if (flag('json')) {
  console.log(JSON.stringify({ findings, metrics }, null, 2));
} else if (flag('summary')) {
  const parts = [];
  for (const [layer, items] of byLayer) {
    const b = items.filter((f) => f.severity === 'BROKEN').length;
    const w = items.filter((f) => f.severity === 'WARN').length;
    if (b || w) parts.push(`${layer} ${b ? `${b} broken` : ''}${b && w ? '/' : ''}${w ? `${w} warn` : ''}`);
  }
  // Top fixes: unique fix commands ordered by severity, max 3.
  const fixes = [];
  for (const sev of ['BROKEN', 'WARN']) for (const f of findings) if (f.severity === sev && f.fix && !fixes.includes(f.fix) && fixes.length < 3) fixes.push(f.fix);
  const head = metrics.findings.broken + metrics.findings.warn === 0 ? 'context-health: clean' : `context-health: ${metrics.findings.broken} broken · ${metrics.findings.warn} warn (${parts.join(', ')})`;
  console.log(`${head}${fixes.length ? ` → ${fixes.join(' · ')}` : ''} — details: /context check`);
} else {
  if (!findings.length) { console.log(`context-health (scope: ${scope}): clean.`); process.exit(0); }
  console.log(`context-health (scope: ${scope}): ${metrics.findings.broken} broken · ${metrics.findings.warn} warnings · ${metrics.findings.info} info\n`);
  for (const [layer, items] of byLayer) {
    const byPage = new Map();
    for (const f of items) { if (!byPage.has(f.page)) byPage.set(f.page, []); byPage.get(f.page).push(f); }
    console.log(`### ${layer} (${items.length})\n`);
    for (const [page, ps] of byPage) {
      console.log(page);
      for (const f of ps) console.log(`  [${f.severity.padEnd(6)}] ${f.message}${f.fix ? `\n           ↳ ${f.fix}` : ''}`);
      console.log('');
    }
  }
}
process.exit(0);
