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

# Scrub Mollie OAuth tokens copied from the test env. They are environment-bound
# and ROTATE on every refresh, so a local copy fights with the test env over the
# same Mollie account's single refresh token and fails with `invalid_grant`.
# Nulling them makes local start cleanly disconnected — reconnect Mollie once
# from the partner app (/account/mollie) before testing payments.
psql "$POSTGRES_URL" -c "UPDATE \"PartnerAccount\" SET mollie_access_token = NULL, mollie_refresh_token = NULL WHERE mollie_access_token IS NOT NULL OR mollie_refresh_token IS NOT NULL;"

echo "Mollie tokens scrubbed locally — reconnect Mollie in the partner app (/account/mollie) before testing payments."

