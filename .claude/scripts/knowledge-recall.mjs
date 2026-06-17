#!/usr/bin/env node
// Semantic recall over the knowledge store. PULL-ONLY — invoked by you or via /recall,
// never auto-injected into a session.
//
//   node knowledge-recall.mjs "query text" [--k 8] [--type gotcha] [--source session-transcript] [--since 2026-01-01]
//                             [--recency 0.2] [--halflife 90]   # recency-decay re-rank; --recency 0 = pure semantic

import pg from 'pg';
import { loadConfig, embedTexts, toVec } from './knowledge-ingest.mjs';

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) { flags[args[i].slice(2)] = args[i + 1]; i++; }
  else positional.push(args[i]);
}
const query = positional.join(' ').trim();
if (!query) {
  console.error('usage: knowledge-recall.mjs "query" [--k N] [--type T] [--source S] [--since DATE]');
  process.exit(2);
}
const k = Math.min(Math.max(parseInt(flags.k || '8', 10) || 8, 1), 50);

// Recency-decay re-ranking (layer-2 retrieval hygiene). Blend semantic similarity with an
// exponential freshness term so the newest record on a topic edges ahead of an equally-
// relevant older one — without burying a markedly-more-relevant old one. λ (recency weight)
// 0 → pure semantic (legacy behaviour); half-life is the age at which the freshness term
// halves. Tunable per-call (flags) or globally (env).
const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
// Default λ=0.2 calibrated against this store (records span ~1 half-life): recency reliably
// breaks ties / supersedes among comparably-relevant records, but a markedly-more-relevant
// older record (≈0.15+ semantic gap) still ranks above a fresher weaker one. λ≥0.25 starts
// overriding real relevance gaps — raise deliberately, not by default.
const recencyWeight = Math.min(1, Math.max(0, num(flags.recency ?? process.env.KNOWLEDGE_RECENCY_WEIGHT, 0.2)));
const halfLifeDays = Math.max(1, num(flags.halflife ?? process.env.KNOWLEDGE_RECENCY_HALFLIFE_DAYS, 90));

const cfg = loadConfig();
const [qvec] = await embedTexts([query], 'query', cfg);

const where = ['embedding IS NOT NULL'];
const params = [toVec(qvec)];
if (flags.type) { params.push(flags.type); where.push(`type=$${params.length}`); }
if (flags.source) { params.push(flags.source); where.push(`source=$${params.length}`); }
if (flags.since) { params.push(flags.since); where.push(`ts >= $${params.length}`); }

// When recency re-ranking is on, pull a larger candidate pool by pure vector distance
// (still index-friendly) and re-rank in JS; otherwise fetch exactly k (legacy path).
const poolSize = recencyWeight > 0 ? Math.min(100, Math.max(k * 5, 24)) : k;

const client = new pg.Client({ connectionString: cfg.dbUrl });
await client.connect();
try {
  const { rows: pool } = await client.query(
    `SELECT type, text, ts, branch, code_version, entities, files, provenance,
            1 - (embedding <=> $1::vector) AS score
     FROM knowledge_record
     WHERE ${where.join(' AND ')}
     ORDER BY embedding <=> $1::vector
     LIMIT ${poolSize}`, params);

  // Blend: final = (1-λ)·semantic + λ·recency, recency = 0.5 ^ (ageDays / halfLife).
  // Missing ts → neutral 0.5 so undated records neither dominate nor vanish.
  const now = Date.now();
  const DAY = 86_400_000;
  const rows = pool.map((r) => {
    const semantic = Number(r.score);
    const t = r.ts instanceof Date ? r.ts.getTime() : Date.parse(r.ts);
    const ageDays = Number.isFinite(t) ? Math.max(0, (now - t) / DAY) : null;
    const recency = ageDays === null ? 0.5 : Math.pow(0.5, ageDays / halfLifeDays);
    const final = recencyWeight > 0 ? (1 - recencyWeight) * semantic + recencyWeight * recency : semantic;
    return { ...r, semantic, recency, final };
  }).sort((a, b) => b.final - a.final).slice(0, k);

  if (!rows.length) {
    console.log('No matching records. (Empty store? Run: node .claude/scripts/knowledge-ingest.mjs --sweep)');
  } else {
    const tuning = recencyWeight > 0 ? `  (recency λ=${recencyWeight}, half-life ${halfLifeDays}d)` : '';
    console.log(`Top ${rows.length} for: "${query}"${tuning}\n`);
    for (const r of rows) {
      const date = (r.ts instanceof Date ? r.ts.toISOString() : String(r.ts)).slice(0, 10);
      const sha = r.code_version ? r.code_version.slice(0, 7) : '???????';
      const breakdown = recencyWeight > 0 ? `  ·  sem ${r.semantic.toFixed(2)} rec ${r.recency.toFixed(2)}` : '';
      console.log(`[${r.final.toFixed(3)}] ${r.type}  ·  ${date}  ·  ${r.branch || '?'}@${sha}${breakdown}`);
      console.log(`  ${r.text}`);
      const meta = [];
      if (r.entities?.length) meta.push('entities: ' + r.entities.join(', '));
      if (r.files?.length) meta.push('files: ' + r.files.slice(0, 4).join(', ') + (r.files.length > 4 ? ` +${r.files.length - 4}` : ''));
      if (meta.length) console.log('  ' + meta.join('  ·  '));
      console.log('');
    }
    console.log('— episodic priors from past sessions; verify against current code before relying on them.');
  }
} finally { await client.end(); }
