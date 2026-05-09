#!/usr/bin/env bash
# GitHub real-time auto-sync watcher.
# Monitors file changes in the workspace and pushes to GitHub every time
# something changes (with a debounce to avoid excessive pushes).
#
# Start via the "GitHub Auto-Sync" Replit workflow.
# Requires GITHUB_TOKEN secret to be set in the Replit Secrets panel.

set -euo pipefail

BRANCH="${GITHUB_BRANCH:-main}"
CLEAN_REMOTE="https://github.com/Kanpary/XaxinoTest.git"
DEBOUNCE_SECS=15

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "[github-sync] GITHUB_TOKEN not set. Set it in the Replit Secrets panel."
  echo "[github-sync] Watcher disabled — exiting."
  exit 0
fi

git config user.email "replit-agent@sync.local" 2>/dev/null || true
git config user.name "Replit Auto-Sync" 2>/dev/null || true

push_to_github() {
  local TIMESTAMP
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  git add -A

  if git diff --cached --quiet; then
    return 0
  fi

  git commit -m "chore: auto-sync $TIMESTAMP [skip ci]" --no-verify 2>&1 | tail -2

  GIT_TOKEN="$GITHUB_TOKEN" git \
    -c "credential.helper=!f() { echo username=x-access-token; echo \"password=\$GIT_TOKEN\"; }; f" \
    push -u origin "$BRANCH" --no-verify 2>&1 | tail -3

  echo "[github-sync] ✓ Pushed at $TIMESTAMP"
}

echo "[github-sync] Starting real-time sync → $CLEAN_REMOTE ($BRANCH)"
echo "[github-sync] Debounce: ${DEBOUNCE_SECS}s between pushes"

last_push=0

while true; do
  sleep "$DEBOUNCE_SECS"

  CHANGES=$(git --no-optional-locks status --porcelain 2>/dev/null | \
    grep -v "^?? .git/" | \
    grep -v "^?? node_modules/" | \
    head -1 || true)

  if [[ -z "$CHANGES" ]]; then
    continue
  fi

  NOW=$(date +%s)
  if (( NOW - last_push < DEBOUNCE_SECS )); then
    continue
  fi

  push_to_github && last_push=$(date +%s) || echo "[github-sync] Push failed (will retry)"
done
