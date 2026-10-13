#!/usr/bin/env node
// knowledge-curated.mjs — index the CURATED and CANONICAL layers into the same vector store
// as the episodic records, so one recall query returns the sharpest slice across every layer
// with its trust tier visible (track 031 P2).
//
//   node knowledge-curated.mjs            # upsert changed units, delete vanished ones
//   node knowledge-curated.mjs --dry-run  # report what would change, no writes, no model load
//   node knowledge-curated.mjs --json
//
// Units (one knowledge_record each; provenance = `path#heading`, content_sha = sha256(text)):
//   playbook entries   .claude/knowledge/<agent>.md  `### YYYY-MM-DD: title` → source playbook:<agent>, status verified
//   wiki sections      .claude/wiki/{entities,flows,subsystems,workflows}/*.md + .claude/context/workflows
//                      split per `##` (long sections chunked)               → source wiki,  status promoted
//   track resume-here  .claude/tracks/NNN-slug.md `## Resume here`           → source track, status verified
//
// Only units whose text changed are re-embedded; unchanged units are untouched (hits/last_hit
// survive). Runs detached from the SessionStart hook (knowledge-ensure.mjs) and by /groom.

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { parseFrontmatter, loadTracks } from './tracks-index.mjs';
import { repoRoot } from './context-config.mjs';

const REPO_ROOT = repoRoot();
const MAX_CHUNK = 1600;      // chars per embedded unit (bge-small truncates ~512 tokens anyway)
const MAX_STORED = 6000;     // chars kept in `text` for display
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// ---- playbooks ----

export function parseTags(s) {
  const out = {};
  for (const part of String(s).split('·')) {
    const m = part.trim().match(/^(\w+)=(.*)$/);
    if (m) out[m[1]] = m[2].split(',').map((x) => x.trim()).filter(Boolean);
  }
  return out;
}

// Sections (`##`) → entries (`### YYYY-MM-DD: title`, optional `tags:` first line, body).
export function parsePlaybook(content) {
  const sections = [];
  let cur = null, entry = null;
  for (const line of content.split('\n')) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) { cur = { heading: h2[1], entries: [] }; sections.push(cur); entry = null; continue; }
    const h3 = line.match(/^###\s+(\d{4}-\d{2}-\d{2}):\s*(.+?)\s*$/);
    if (h3) {
      if (!cur) { cur = { heading: '(untitled)', entries: [] }; sections.push(cur); }
      entry = { date: h3[1], title: h3[2], section: cur.heading, body: [], tags: {} };
      cur.entries.push(entry);
      continue;
    }
    if (!entry) continue;
    const t = line.match(/^tags:\s*(.+)$/);
    if (t && entry.body.every((l) => !l.trim())) { entry.tags = parseTags(t[1]); continue; }
    entry.body.push(line);
  }
  return sections;
}

function playbookUnits() {
  const dir = join(REPO_ROOT, '.claude/knowledge');
  const units = [];
  if (!existsSync(dir)) return units;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md') || f === 'README.md') continue;
    const agent = f.replace(/\.md$/, '');
    const relPath = `.claude/knowledge/${f}`;
    const content = readFileSync(join(dir, f), 'utf8');
    for (const s of parsePlaybook(content)) {
      if (/navigation index/i.test(s.heading)) continue;
      const type = /rejected|dead[- ]end/i.test(s.heading) ? 'dead-end' : 'gotcha';
      for (const e of s.entries) {
        const body = e.body.join('\n').trim();
        const text = `[${agent} playbook · ${s.heading}] ${e.title}\n${body}`.slice(0, MAX_STORED);
        units.push({
          source: `playbook:${agent}`, status: 'verified', type,
          text, embedText: text.slice(0, MAX_CHUNK * 2),
          ts: e.date, provenance: `${relPath}#${e.title}`,
          entities: e.tags.entities || [], files: (e.tags.files || []).concat(e.tags.track ? e.tags.track.map((t) => `track:${t}`) : []),
        });
      }
    }
  }
  return units;
}

// ---- wiki ----

function fmList(fm, key) {
  const m = (fm || '').match(new RegExp(`^${key}:\\s*\\n((?:\\s+-\\s+.+\\n?)+)`, 'm'));
  if (!m) return [];
  return m[1].split('\n').map((l) => l.match(/^\s+-\s+(.+?)\s*$/)).filter(Boolean).map((x) => x[1]);
}

function chunk(text) {
  if (text.length <= MAX_CHUNK) return [text];
  const out = [];
  let buf = '';
  for (const para of text.split(/\n{2,}/)) {
    if (buf && buf.length + para.length + 2 > MAX_CHUNK) { out.push(buf); buf = ''; }
    buf = buf ? buf + '\n\n' + para : para;
    while (buf.length > MAX_CHUNK) { out.push(buf.slice(0, MAX_CHUNK)); buf = buf.slice(MAX_CHUNK); }
  }
  if (buf) out.push(buf);
  return out;
}

function wikiUnits() {
  const units = [];
  const roots = ['.claude/wiki/entities', '.claude/wiki/flows', '.claude/wiki/subsystems', '.claude/wiki/workflows', '.claude/context/workflows'];
  for (const r of roots) {
    const dir = join(REPO_ROOT, r);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const relPath = `${r}/${f}`;
      const raw = readFileSync(join(dir, f), 'utf8');
      const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      const fm = m ? m[1] : '';
      const body = (m ? m[2] : raw).replace(/```[\s\S]*?```/g, '');
      const slug = (fm.match(/^slug:\s*(.+)$/m) || [])[1]?.trim() || f.replace(/\.md$/, '');
      const type = (fm.match(/^type:\s*(.+)$/m) || [])[1]?.trim() || r.split('/').pop().replace(/s$/, '');
      const lastVerified = (fm.match(/^last_verified:\s*(.+)$/m) || [])[1]?.trim() || null;
      const files = fmList(fm, 'sources').map((s) => s.split('#')[0]);
      const related = fmList(fm, 'related').map((s) => s.split(':').pop());
      // split per ## heading; the preamble (title + intro) is its own unit
      const parts = body.split(/^(?=##\s)/m);
      for (const part of parts) {
        const h = part.match(/^##\s+(.+?)\s*$/m);
        const heading = h ? h[1] : 'intro';
        const sectionText = part.replace(/^##\s+.+$/m, '').trim();
        if (!sectionText || sectionText.length < 40) continue;
        const chunks = chunk(sectionText);
        chunks.forEach((c, i) => {
          const text = `[wiki ${type}:${slug} · ${heading}] ${c}`;
          units.push({
            source: 'wiki', status: 'promoted', type: 'observation',
            text: text.slice(0, MAX_STORED), embedText: text,
            ts: lastVerified, provenance: `${relPath}#${heading}${chunks.length > 1 ? `#${i + 1}` : ''}`,
            entities: [slug, ...related].slice(0, 8), files: files.slice(0, 8),
          });
        });
      }
    }
  }
  return units;
}

// ---- tracks ----

function trackUnits() {
  const units = [];
  const { tracks } = loadTracks(REPO_ROOT);
  for (const t of tracks) {
    const m = t.body.match(/^##\s+Resume here\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/mi);
    const resume = (m ? m[1] : '').replace(/```[\s\S]*?```/g, '').trim();
    if (!resume) continue;
    const text = `[track ${t.fm.id} · ${t.fm.status}] ${t.fm.title}\nResume here: ${resume}`.slice(0, MAX_STORED);
    units.push({
      source: 'track', status: 'verified', type: 'decision',
      text, embedText: text.slice(0, MAX_CHUNK * 2),
      ts: t.fm.updated || null, provenance: `.claude/tracks/${t.file}#Resume here`,
      entities: [], files: [],
    });
  }
  return units;
}

export function collectCuratedUnits() {
  const units = [...playbookUnits(), ...wikiUnits(), ...trackUnits()];
  const seen = new Map();
  for (const u of units) {
    // provenance must be unique; two entries with the same title get a numeric suffix
    const n = (seen.get(u.provenance) || 0) + 1;
    seen.set(u.provenance, n);
    if (n > 1) u.provenance = `${u.provenance}#${n}`;
    u.sha = sha256(u.text);
  }
  return units;
}

// ---- diff against the store ----

export async function planCurated(client) {
  const units = collectCuratedUnits();
  const { rows } = await client.query(`SELECT id, source, provenance, content_sha FROM knowledge_record WHERE source = 'wiki' OR source = 'track' OR source LIKE 'playbook:%'`);
  const existing = new Map(rows.map((r) => [r.provenance, r]));
  const want = new Map(units.map((u) => [u.provenance, u]));
  const toDelete = rows.filter((r) => !want.has(r.provenance) || want.get(r.provenance).sha !== r.content_sha);
  const toInsert = units.filter((u) => !existing.has(u.provenance) || existing.get(u.provenance).content_sha !== u.sha);
  return { units, existing: rows.length, toDelete, toInsert };
}

export async function indexCurated(client, cfg, opts = {}) {
  const plan = await planCurated(client);
  const summary = { total: plan.units.length, existing: plan.existing, insert: plan.toInsert.length, delete: plan.toDelete.length };
  if (opts.dryRun || (!plan.toInsert.length && !plan.toDelete.length)) return { ...summary, changed: false };
  const { embedTexts, toVec } = await import('./knowledge-ingest.mjs');
  const vectors = await embedTexts(plan.toInsert.map((u) => u.embedText), 'document', cfg);
  await client.query('BEGIN');
  try {
    if (plan.toDelete.length) await client.query('DELETE FROM knowledge_record WHERE id = ANY($1::bigint[])', [plan.toDelete.map((r) => r.id)]);
    for (let i = 0; i < plan.toInsert.length; i++) {
      const u = plan.toInsert[i];
      await client.query(
        `INSERT INTO knowledge_record (source,type,text,embedding,ts,code_version,branch,entities,files,provenance,status,content_sha)
         VALUES ($1,$2,$3,$4::vector,COALESCE($5::timestamptz, now()),NULL,NULL,$6,$7,$8,$9,$10)`,
        [u.source, u.type, u.text, toVec(vectors[i]), u.ts, u.entities, u.files, u.provenance, u.status, u.sha]
      );
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  return { ...summary, changed: true };
}

// ---- CLI ----
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const { loadConfig } = await import('./knowledge-ingest.mjs');
  const pg = (await import('pg')).default;
  const cfg = loadConfig();
  const client = new pg.Client({ connectionString: cfg.dbUrl });
  await client.connect();
  try {
    const res = await indexCurated(client, cfg, { dryRun });
    if (args.includes('--json')) console.log(JSON.stringify(res));
    else console.log(`curated index: ${res.total} units (${res.existing} stored) — ${dryRun ? 'would ' : ''}insert ${res.insert}, delete ${res.delete}${res.changed ? '' : ' (no change)'}`);
  } finally { await client.end(); }
}
