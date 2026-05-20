#!/usr/bin/env node
// Multi-layer mechanical drift detection for AI context metadata.
// No LLM, no external dependencies. Runs in < 1 second.
//
// Scope:
//   --scope wiki        Wiki only (.claude/wiki/)
//   --scope canonical   Canonical layer (CLAUDE.md tree, .claude/rules/, PROJECT_CONTEXT.md)
//   --scope all         Both (default)
//
// Detects (per layer):
//   - sources: frontmatter paths that no longer exist          (wiki only — canonical has no frontmatter)
//   - inline `path/file.ts[#symbol|:line]` refs whose file or symbol is gone
//     (only paths starting with apps/, packages/, .claude/, or prisma/ — bare filenames
//      and partial paths in prose are intentionally ignored)
//   - [[type:slug]] cross-refs that resolve to nothing (and aren't listed under wiki's "Planned")
//
// Does NOT detect (needs LLM judgment — see .claude/context/workflows/check.md "full" mode):
//   - Behavioral changes / semantic renames
//   - Whether documented invariants still hold
//   - Whether pitfalls are still relevant
//   - Route mentions (NextAuth catch-alls and dynamic segments make this too noisy at the grep tier)
//
// Output: structured report on stdout grouped by layer. Always exits 0 (warn-only).

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { execSync } from 'child_process';

const REPO_ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();

// ---- CLI ----

const args = process.argv.slice(2);
let scope = 'all';
const scopeIdx = args.findIndex(a => a === '--scope');
if (scopeIdx !== -1 && args[scopeIdx + 1]) scope = args[scopeIdx + 1];
const scopeEq = args.find(a => a.startsWith('--scope='));
if (scopeEq) scope = scopeEq.split('=')[1];
if (!['all', 'wiki', 'canonical'].includes(scope)) {
  console.error(`Unknown scope: ${scope}. Use --scope wiki|canonical|all`);
  process.exit(2);
}

// ---- Constants ----

const EXAMPLE_SLUGS = new Set(['baz', 'slug', 'name', 'foo', 'related-flow', 'related-entity', 'involved-subsystem', 'primary-entity']);
const PATH_PREFIX_RE = /^(apps|packages|\.claude|prisma)\//;
const DIR_TO_TYPE = { entities: 'entity', flows: 'flow', subsystems: 'subsystem', workflows: 'workflow' };

// Append-only chronological files. Their refs are historical snapshots and may not
// resolve against current code — that's correct by design.
const APPEND_ONLY_FILES = new Set(['log.md']);

// ---- helpers ----

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (entry.endsWith('.md')) files.push(full);
  }
  return files;
}

function splitFrontmatterAndBody(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm: '', body: content };
  return { fm: m[1], body: m[2] };
}

function stripFencedCodeBlocks(text) {
  return text.replace(/```[\s\S]*?```/g, '');
}

function extractListUnderKey(fm, key) {
  const re = new RegExp(`^${key}:\\s*\\n((?:\\s+-\\s+.+\\n?)+)`, 'm');
  const m = fm.match(re);
  if (!m) return [];
  return m[1]
    .split('\n')
    .map(l => l.match(/^\s+-\s+(.+?)\s*$/))
    .filter(Boolean)
    .map(m => m[1])
    .filter(v => !/[<>]/.test(v));
}

function extractInlineRefs(body) {
  const refs = [];
  const re = /`([\w./\[\]-]+\.(?:ts|tsx|prisma|sql|mjs|js))(?:#(\w+)|:(\d+))?`/g;
  let m;
  while ((m = re.exec(body))) {
    if (!PATH_PREFIX_RE.test(m[1])) continue;
    refs.push({ path: m[1], symbol: m[2] || null, line: m[3] || null });
  }
  return refs;
}

function extractCrossRefs(text) {
  return [...text.matchAll(/\[\[([a-z]+):([a-z0-9-]+)\]\]/g)].map(m => ({ type: m[1], slug: m[2] }));
}

function fileExistsRel(relPath) {
  const clean = relPath.split('#')[0].split(':')[0];
  return existsSync(join(REPO_ROOT, clean));
}

function symbolFoundInFile(relPath, symbol) {
  const clean = relPath.split('#')[0].split(':')[0];
  const full = join(REPO_ROOT, clean);
  if (!existsSync(full)) return false;
  const content = readFileSync(full, 'utf8');
  const prefixed = symbol.match(/^(model|enum|interface|type|class|function)-(.+)$/);
  if (prefixed) {
    return new RegExp(`\\b${prefixed[1]}\\s+${prefixed[2]}\\b`).test(content);
  }
  const patterns = [
    `\\bfunction\\s+${symbol}\\b`,
    `\\bconst\\s+${symbol}\\b`,
    `\\blet\\s+${symbol}\\b`,
    `\\bclass\\s+${symbol}\\b`,
    `\\bmodel\\s+${symbol}\\b`,
    `\\benum\\s+${symbol}\\b`,
    `\\binterface\\s+${symbol}\\b`,
    `\\btype\\s+${symbol}\\b`,
    `\\bexport\\s+(?:default\\s+)?(?:async\\s+)?(?:function|const|let|class)\\s+${symbol}\\b`,
  ];
  return patterns.some(p => new RegExp(p).test(content));
}

// ---- Wiki slug catalog (used to validate [[type:slug]] cross-refs from ANY layer) ----

function buildWikiSlugCatalog() {
  const wikiDir = join(REPO_ROOT, '.claude/wiki');
  const existingSlugs = new Set();
  for (const p of walk(wikiDir)) {
    const rel = relative(wikiDir, p);
    const m = rel.match(/^(\w+)\/([\w-]+)\.md$/);
    if (m && DIR_TO_TYPE[m[1]]) existingSlugs.add(`${DIR_TO_TYPE[m[1]]}:${m[2]}`);
  }
  const indexPath = join(wikiDir, 'index.md');
  const plannedSlugs = new Set();
  if (existsSync(indexPath)) {
    const indexContent = readFileSync(indexPath, 'utf8');
    const plannedSection = indexContent.match(/##\s+Planned[\s\S]*?(?=^##\s|$)/m);
    if (plannedSection) {
      for (const m of plannedSection[0].matchAll(/`([\w-]+)`/g)) plannedSlugs.add(m[1]);
    }
  }
  return { existingSlugs, plannedSlugs };
}

const { existingSlugs, plannedSlugs } = buildWikiSlugCatalog();

// ---- Layer file collectors ----

function canonicalFiles() {
  const files = [];
  for (const f of ['CLAUDE.md', 'PROJECT_CONTEXT.md']) {
    const full = join(REPO_ROOT, f);
    if (existsSync(full)) files.push(full);
  }
  for (const base of ['apps', 'packages']) {
    const dir = join(REPO_ROOT, base);
    if (!existsSync(dir)) continue;
    for (const sub of readdirSync(dir)) {
      const claudeMd = join(dir, sub, 'CLAUDE.md');
      if (existsSync(claudeMd)) files.push(claudeMd);
    }
  }
  const rulesDir = join(REPO_ROOT, '.claude/rules');
  if (existsSync(rulesDir)) {
    for (const f of readdirSync(rulesDir)) {
      if (f.endsWith('.md')) files.push(join(rulesDir, f));
    }
  }
  return files;
}

const LAYERS = {
  wiki: { files: () => walk(join(REPO_ROOT, '.claude/wiki')), hasFrontmatter: true },
  canonical: { files: canonicalFiles, hasFrontmatter: false },
};

// ---- Scan ----

const findings = [];
const add = (layer, page, severity, message) => findings.push({ layer, page, severity, message });

const scopesToRun = scope === 'all' ? ['wiki', 'canonical'] : [scope];

for (const layerName of scopesToRun) {
  const layer = LAYERS[layerName];
  for (const pagePath of layer.files()) {
    const baseName = pagePath.split('/').pop();
    if (APPEND_ONLY_FILES.has(baseName)) continue;
    const content = readFileSync(pagePath, 'utf8');
    const { fm, body } = splitFrontmatterAndBody(content);
    const scannable = stripFencedCodeBlocks(body);
    const pageRel = relative(REPO_ROOT, pagePath);

    if (layer.hasFrontmatter) {
      for (const src of extractListUnderKey(fm, 'sources')) {
        const cleanPath = src.split('#')[0].split(':')[0];
        if (!fileExistsRel(cleanPath)) {
          add(layerName, pageRel, 'BROKEN', `source missing: ${src}`);
        } else if (src.includes('#')) {
          const symbol = src.split('#')[1];
          if (!symbolFoundInFile(cleanPath, symbol)) {
            add(layerName, pageRel, 'WARN', `source symbol not found: ${src} (heuristic — may be false positive)`);
          }
        }
      }
    }

    for (const ref of extractInlineRefs(scannable)) {
      if (!fileExistsRel(ref.path)) {
        add(layerName, pageRel, 'BROKEN', `inline ref: ${ref.path} (file missing)`);
      } else if (ref.symbol && !symbolFoundInFile(ref.path, ref.symbol)) {
        add(layerName, pageRel, 'WARN', `inline ref: ${ref.path}#${ref.symbol} (symbol not found — heuristic)`);
      }
    }

    for (const xr of extractCrossRefs(scannable)) {
      if (EXAMPLE_SLUGS.has(xr.slug)) continue;
      const key = `${xr.type}:${xr.slug}`;
      if (existingSlugs.has(key) || plannedSlugs.has(xr.slug)) continue;
      add(layerName, pageRel, 'WARN', `unresolved cross-ref: [[${key}]] (no wiki page, not in Planned)`);
    }
  }
}

// ---- Output ----

if (findings.length === 0) {
  console.log(`Context drift check (scope: ${scope}): no issues found.`);
  process.exit(0);
}

const byLayer = new Map();
for (const f of findings) {
  if (!byLayer.has(f.layer)) byLayer.set(f.layer, []);
  byLayer.get(f.layer).push(f);
}

const broken = findings.filter(f => f.severity === 'BROKEN').length;
const warn = findings.filter(f => f.severity === 'WARN').length;

console.log(`Context drift detected (${broken} broken, ${warn} warnings, scope: ${scope}):\n`);

for (const [layerName, items] of byLayer) {
  const byPage = new Map();
  for (const f of items) {
    if (!byPage.has(f.page)) byPage.set(f.page, []);
    byPage.get(f.page).push(f);
  }
  console.log(`### Layer: ${layerName} (${items.length} findings)\n`);
  for (const [page, ps] of byPage) {
    console.log(page);
    for (const f of ps) console.log(`  [${f.severity.padEnd(7)}] ${f.message}`);
    console.log('');
  }
}

const wikiPages = [...new Set((byLayer.get('wiki') || []).map(f => f.page.replace('.claude/wiki/', '')))];
const canonicalPages = [...new Set((byLayer.get('canonical') || []).map(f => f.page))];

if (wikiPages.length) console.log(`Suggested for wiki:      /wiki ingest ${wikiPages.join(' ')}`);
if (canonicalPages.length) console.log(`Suggested for canonical: /update-knowledge (scope to affected files: ${canonicalPages.join(', ')})`);

process.exit(0);
