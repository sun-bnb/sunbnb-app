# Track 030 packet D1 - progress note (data-dev)

Done: migration 20261011120000_assistant_reader_role_and_views (role, assistant schema, 13 views, claim fn,
RLS on 13 tables, column grants) applied to local + sunbnb_test; assistant-claim.ts (+ export);
scripts/setup-assistant-reader.{sh,cjs} run for local + integration; env values in apps/partner/.env.local,
packages/data/.env.local, dev-env.local; 93 integration tests green (assistant-reader.integration.test.ts);
migration verified as non-superuser CREATEROLE owner + idempotent re-run.
Remaining: tsc/lint green check, CLAUDE.md + migrations.md docs, final report.
Decisions: real cuids exposed only where views join; view names sunbed/reservation_seat(sunbed_id);
paid_via via SECURITY DEFINER helper (payment_ref ungranted); runner pins timeout/search_path txn-locally;
script is .cjs because packages/data/scripts/*.mjs is gitignored. NOT run: migrate:test / migrate:production.
