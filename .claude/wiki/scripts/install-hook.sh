#!/usr/bin/env sh
# Install the AI context drift pre-push checker into .git/hooks/.
# Backs up an existing pre-push hook if one is present (and not already ours).

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
SAMPLE="$REPO_ROOT/.claude/hooks/pre-push.sample"
TARGET="$REPO_ROOT/.git/hooks/pre-push"

if [ ! -f "$SAMPLE" ]; then
  echo "Sample hook not found at $SAMPLE" >&2
  exit 1
fi

if [ -f "$TARGET" ] && ! grep -q 'detect-drift.mjs' "$TARGET"; then
  BACKUP="$TARGET.backup.$(date +%s)"
  echo "Existing pre-push hook found. Backing up to $BACKUP"
  cp "$TARGET" "$BACKUP"
fi

cp "$SAMPLE" "$TARGET"
chmod +x "$TARGET"

echo "Installed AI context drift pre-push hook at .git/hooks/pre-push"
echo "Test: node .claude/scripts/detect-drift.mjs"
