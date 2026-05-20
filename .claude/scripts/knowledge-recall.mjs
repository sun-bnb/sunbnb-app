#!/usr/bin/env node
// Semantic recall over the knowledge store. PULL-ONLY — invoked by you or via /recall,
// never auto-injected into a session.
//
//   node knowledge-recall.mjs "query text" [--k 8] [--type gotcha] [--source session-transcript] [--since 2026-01-01]

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

const cfg = loadConfig();
const [qvec] = await embedTexts([query], 'query', cfg);

const where = ['embedding IS NOT NULL'];
const params = [toVec(qvec)];
if (flags.type) { params.push(flags.type); where.push(`type=$${params.length}`); }
if (flags.source) { params.push(flags.source); where.push(`source=$${params.length}`); }
if (flags.since) { params.push(flags.since); where.push(`ts >= $${params.length}`); }

const client = new pg.Client({ connectionString: cfg.dbUrl });
await client.connect();
try {
  const { rows } = await client.query(
    `SELECT type, text, ts, branch, code_version, entities, files, provenance,
            1 - (embedding <=> $1::vector) AS score
     FROM knowledge_record
     WHERE ${where.join(' AND ')}
     ORDER BY embedding <=> $1::vector
     LIMIT ${k}`, params);

  if (!rows.length) {
    console.log('No matching records. (Empty store? Run: node .claude/scripts/knowledge-ingest.mjs --sweep)');
  } else {
    console.log(`Top ${rows.length} for: "${query}"\n`);
    for (const r of rows) {
      const date = (r.ts instanceof Date ? r.ts.toISOString() : String(r.ts)).slice(0, 10);
      const sha = r.code_version ? r.code_version.slice(0, 7) : '???????';
      console.log(`[${Number(r.score).toFixed(3)}] ${r.type}  ·  ${date}  ·  ${r.branch || '?'}@${sha}`);
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
