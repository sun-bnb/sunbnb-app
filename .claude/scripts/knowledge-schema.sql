-- Knowledge store schema (Phase 0).
-- Single normalized record table + an ingestion ledger. Backend is pgvector.
--
-- Provision the container (durable: named volume survives `docker rm`/reboot; auto-restarts).
-- <container>, <volume>, <password>, <port>, <database> come from .claude/context/project.json
-- `store` (defaults derive from the project slug; see context-config.mjs). For this repo:
-- sunbnb-knowledge-postgres, sunbnb-knowledge-data, sunbnb, 5434, sunbnb_knowledge.
--   docker run -d --name <container> --restart unless-stopped \
--     -e POSTGRES_PASSWORD=<password> -p <port>:5432 \
--     -v <volume>:/var/lib/postgresql/data pgvector/pgvector:pg17
--   docker exec <container> psql -U postgres -c "CREATE DATABASE <database>;"
-- Apply this schema:
--   docker exec -i <container> psql -U postgres -d <database> < this file
--
-- The record shape is the durable contract: every datasource adapter (Phase 0 = session
-- transcripts; later = logs, reconcile reports, ...) maps its data into knowledge_record.
-- Only `source` distinguishes them. Swapping the storage backend or embedding model later
-- must not require changing this shape.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS knowledge_record (
  id            BIGSERIAL PRIMARY KEY,
  source        TEXT        NOT NULL,                 -- 'session-transcript' (episodic) | 'wiki' | 'track' | 'playbook:<agent>' (curated, track 031)
  type          TEXT        NOT NULL,                 -- decision | incident | gotcha | dead-end | observation
  text          TEXT        NOT NULL,                 -- distilled + redacted content (this is what gets embedded)
  embedding     vector(384),                          -- local bge-small (384-dim); NULL until embedded
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),   -- when the underlying episode occurred (session time)
  code_version  TEXT,                                 -- git SHA approx. at episode time (staleness lever)
  branch        TEXT,
  entities      TEXT[]      NOT NULL DEFAULT '{}',    -- domain entities referenced (settlement, reservation, ...)
  files         TEXT[]      NOT NULL DEFAULT '{}',    -- files touched in the episode
  provenance    TEXT,                                 -- session_id (or other source ref)
  status        TEXT        NOT NULL DEFAULT 'raw',   -- raw | verified | promoted
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Track 031 (credit → promotion loop + curated indexing). Idempotent — safe to re-apply.
--   hits / last_hit : a recall hit that helped is credited by `knowledge-recall.mjs --credit <id>`;
--                     credits feed `--candidates` and `/groom` (episodic → curated promotion)
--   content_sha     : SHA-256 of the indexed text for curated units (playbook entries, wiki
--                     sections, track resume-heres) so `knowledge-curated.mjs` re-embeds only changes
ALTER TABLE knowledge_record ADD COLUMN IF NOT EXISTS hits        INT         NOT NULL DEFAULT 0;
ALTER TABLE knowledge_record ADD COLUMN IF NOT EXISTS last_hit    TIMESTAMPTZ;
ALTER TABLE knowledge_record ADD COLUMN IF NOT EXISTS content_sha TEXT;
CREATE INDEX IF NOT EXISTS knowledge_record_provenance_idx ON knowledge_record (provenance);
CREATE INDEX IF NOT EXISTS knowledge_record_status_idx     ON knowledge_record (status);

-- ANN index for cosine similarity search. NULL embeddings are simply not indexed.
CREATE INDEX IF NOT EXISTS knowledge_record_embedding_idx
  ON knowledge_record USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS knowledge_record_source_idx   ON knowledge_record (source);
CREATE INDEX IF NOT EXISTS knowledge_record_type_idx     ON knowledge_record (type);
CREATE INDEX IF NOT EXISTS knowledge_record_ts_idx       ON knowledge_record (ts DESC);
CREATE INDEX IF NOT EXISTS knowledge_record_entities_idx ON knowledge_record USING gin (entities);

-- Ledger: which sessions are already ingested. Drives idempotency (skip seen sessions)
-- and lets the sweep job detect un-ingested transcripts. transcript_sha allows re-ingest
-- when a session file changed (resumed sessions grow).
CREATE TABLE IF NOT EXISTS ingested_session (
  session_id      TEXT PRIMARY KEY,
  transcript_sha  TEXT,
  record_count    INT         NOT NULL DEFAULT 0,
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
