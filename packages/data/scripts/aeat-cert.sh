#!/usr/bin/env bash
#
# aeat-cert.sh — custody of the Veri*factu AEAT certificate (track 026).
#
# The FNMT certificate (.pfx) and its passphrase live in the macOS login
# Keychain and nowhere else on the laptop: not in the repo, not in a .env.local,
# not on the clipboard. This script is the only thing that moves them.
#
#   aeat-cert.sh import <file.pfx>     store in Keychain (passphrase typed into the
#                                      `security` prompt, verified before storing)
#   aeat-cert.sh status                subject / issuer / validity + Node TLS load test
#   aeat-cert.sh exec -- <command...>  run ONE command with the certificate in its
#                                      environment (defaults AEAT_MODE=http,
#                                      AEAT_ENV=pruebas)
#   aeat-cert.sh vercel-production --yes-production
#                                      upsert the pair as SENSITIVE (write-only) vars
#                                      + AEAT_ENV=production on the admin project's
#                                      Production environment only
#   aeat-cert.sh vercel-mode <off|http> --yes-production
#                                      set AEAT_MODE on admin Production (the pause
#                                      switch). Takes effect on the next deployment.
#   aeat-cert.sh forget                remove both Keychain items
#
# Preproducción run (Phase 3), against the TEST database:
#   aeat-cert.sh exec -- npm run verifactu:submit:test
#
# Never `set -x` here: it would print the secrets.
set -euo pipefail

ACCOUNT="sunbnb"
SVC_PFX="sunbnb-aeat-cert-pfx"
SVC_PASS="sunbnb-aeat-cert-password"
TEAM_ID="team_agH1QD6UnkQOjJQEAbmLbmzI"
ADMIN_PROJECT="sunbnb-app-admin"
VERCEL_AUTH="$HOME/Library/Application Support/com.vercel.cli/auth.json"
HERE="$(cd "$(dirname "$0")" && pwd)"

die() { echo "aeat-cert: $*" >&2; exit 1; }

# read_secret <service> — print a Keychain item's value exactly as stored.
#
# NOT `security find-generic-password -w`: for any value containing a non-ASCII
# byte (ä, ñ, €…) `-w` prints it as bare HEX, indistinguishable from an ASCII
# value that happens to be hex digits — so a correct non-ASCII passphrase was
# read back as its hex spelling and rejected. `-g` marks the hex form with `0x`
# (`password: 0x50C3A4… "…"`) and prints ASCII as `password: "…"`, which is
# unambiguous. It writes that line to stderr.
read_secret() {
  security find-generic-password -a "$ACCOUNT" -s "$1" -g 2>&1 >/dev/null | python3 -c '
import sys, re
for line in sys.stdin:
    if not line.startswith("password: "):
        continue
    v = line[len("password: "):].rstrip("\n")
    m = re.match(r"0x([0-9A-Fa-f]+)", v)
    if m:
        sys.stdout.buffer.write(bytes.fromhex(m.group(1)))
    elif v.startswith("\"") and v.endswith("\""):
        sys.stdout.write(v[1:-1])
    else:
        sys.exit(1)  # empty item ("password: ") or an unrecognised form
    sys.exit(0)
sys.exit(1)
'
}

load_from_keychain() {
  AEAT_CERT_PFX_BASE64="$(read_secret "$SVC_PFX")" \
    || die "no certificate in Keychain — run: aeat-cert.sh import <file.pfx>"
  AEAT_CERT_PASSWORD="$(read_secret "$SVC_PASS")" \
    || die "no passphrase in Keychain — run: aeat-cert.sh import <file.pfx>"
  export AEAT_CERT_PFX_BASE64 AEAT_CERT_PASSWORD
}

cmd_status() {
  load_from_keychain
  (cd "$HERE/.." && npx --yes tsx scripts/aeat-cert-status.ts)
}

cmd_import() {
  local pfx="${1:-}"
  [ -n "$pfx" ] && [ -f "$pfx" ] || die "usage: aeat-cert.sh import <file.pfx>"

  echo "Type the certificate passphrase into the prompt below (twice). It is stored in"
  echo "the login Keychain as '$SVC_PASS' and never echoed."
  # -w LAST makes `security` prompt for the value itself, so the passphrase is
  # never in this script's argv, environment of the shell, or history.
  security add-generic-password -U -a "$ACCOUNT" -s "$SVC_PASS" \
    -l "Sunbnb AEAT certificate passphrase" -w

  local pass
  pass="$(read_secret "$SVC_PASS")" || die "could not read the passphrase back from Keychain"
  # Verify BEFORE storing the certificate; passed to openssl through its env.
  if ! AEAT_CERT_PASSWORD="$pass" openssl pkcs12 -in "$pfx" -passin env:AEAT_CERT_PASSWORD \
      -noout 2>/dev/null; then
    security delete-generic-password -a "$ACCOUNT" -s "$SVC_PASS" >/dev/null 2>&1 || true
    die "that passphrase does not open $pfx — nothing stored (it is case-sensitive; it is
the one set when the certificate was EXPORTED from the browser/Keychain, not the FNMT
request code)"
  fi
  unset pass

  # The base64 .pfx goes through argv: `security` has no stdin form for a value
  # of this size, and the file alone is useless without the passphrase above.
  security add-generic-password -U -a "$ACCOUNT" -s "$SVC_PFX" \
    -l "Sunbnb AEAT certificate (PKCS#12, base64)" -w "$(base64 -i "$pfx" | tr -d '\n')"

  echo "Stored. Verifying what was stored:"
  cmd_status
  echo
  echo "Keep the original .pfx and passphrase in your password manager, then delete"
  echo "the copy at: $pfx"
}

cmd_exec() {
  [ "${1:-}" = "--" ] && shift
  [ "$#" -gt 0 ] || die "usage: aeat-cert.sh exec -- <command...>"
  load_from_keychain
  export AEAT_MODE="${AEAT_MODE:-http}"
  export AEAT_ENV="${AEAT_ENV:-pruebas}"
  exec "$@"
}

vercel_token() {
  [ -f "$VERCEL_AUTH" ] || die "no Vercel CLI login at $VERCEL_AUTH — run: vercel login"
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["token"])' "$VERCEL_AUTH"
}

# vercel_upsert <json-array-on-stdin>. The token travels in a header FILE and the
# body on stdin, so neither secret is ever in a process's argv.
vercel_upsert() {
  local token project_id status
  token="$(vercel_token)"
  project_id="$(curl -sS -H @<(printf 'Authorization: Bearer %s' "$token") \
    "https://api.vercel.com/v9/projects/$ADMIN_PROJECT?teamId=$TEAM_ID" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))')"
  [ -n "$project_id" ] || die "could not resolve the $ADMIN_PROJECT project"
  status="$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
    -H @<(printf 'Authorization: Bearer %s' "$token") \
    -H 'Content-Type: application/json' --data-binary @- \
    "https://api.vercel.com/v10/projects/$project_id/env?teamId=$TEAM_ID&upsert=true")"
  echo "Vercel $ADMIN_PROJECT env upsert: HTTP $status"
  [ "$status" = "200" ] || [ "$status" = "201" ] || die "upsert failed"
}

cmd_vercel_production() {
  [ "${1:-}" = "--yes-production" ] || die "this writes PRODUCTION env vars; re-run with --yes-production"
  load_from_keychain
  # Body built from the environment by node, not interpolated into a string.
  node -e '
    const e = process.env
    process.stdout.write(JSON.stringify([
      { key: "AEAT_CERT_PFX_BASE64", value: e.AEAT_CERT_PFX_BASE64, type: "sensitive", target: ["production"] },
      { key: "AEAT_CERT_PASSWORD", value: e.AEAT_CERT_PASSWORD, type: "sensitive", target: ["production"] },
      { key: "AEAT_ENV", value: "production", type: "encrypted", target: ["production"] },
    ]))
  ' | vercel_upsert
  echo "Set AEAT_CERT_PFX_BASE64, AEAT_CERT_PASSWORD (sensitive) and AEAT_ENV=production on"
  echo "$ADMIN_PROJECT Production. AEAT_MODE is unchanged — see: aeat-cert.sh vercel-mode"
}

cmd_vercel_mode() {
  local mode="${1:-}"
  [ "$mode" = "off" ] || [ "$mode" = "http" ] || die "usage: aeat-cert.sh vercel-mode <off|http> --yes-production"
  [ "${2:-}" = "--yes-production" ] || die "this writes a PRODUCTION env var; re-run with --yes-production"
  printf '[{"key":"AEAT_MODE","value":"%s","type":"encrypted","target":["production"]}]' "$mode" \
    | vercel_upsert
  echo "AEAT_MODE=$mode on $ADMIN_PROJECT Production — redeploy admin production to apply."
}

cmd_forget() {
  security delete-generic-password -a "$ACCOUNT" -s "$SVC_PFX" >/dev/null 2>&1 || true
  security delete-generic-password -a "$ACCOUNT" -s "$SVC_PASS" >/dev/null 2>&1 || true
  echo "Removed both Keychain items (if present)."
}

sub="${1:-}"; shift || true
case "$sub" in
  import) cmd_import "$@" ;;
  status) cmd_status ;;
  exec) cmd_exec "$@" ;;
  vercel-production) cmd_vercel_production "$@" ;;
  vercel-mode) cmd_vercel_mode "$@" ;;
  forget) cmd_forget ;;
  *) sed -n '3,27p' "$0" | sed 's/^# \{0,1\}//'; exit 64 ;;
esac
