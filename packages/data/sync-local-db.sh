#!/usr/bin/env bash

# Exit immediately on error
set -e

# Ensure the variables exist in the environment
if [ -z "$POSTGRES_URL_TEST" ]; then
  echo "Error: POSTGRES_URL_TEST is not set."
  exit 1
fi

if [ -z "$POSTGRES_URL" ]; then
  echo "Error: POSTGRES_URL is not set."
  exit 1
fi

echo "Syncing from remote test DB ($POSTGRES_URL_TEST) to local DB ($POSTGRES_URL)"

# Optionally drop and recreate the public schema in the local DB
psql "$POSTGRES_URL" -c "DROP SCHEMA public CASCADE;"
psql "$POSTGRES_URL" -c "CREATE SCHEMA public;"

# Dump from the remote test DB and pipe directly into local
pg_dump "$POSTGRES_URL_TEST" | psql "$POSTGRES_URL"

echo "Local DB has been overwritten with data from the test DB."

