#!/bin/bash
# GitHub sync helper — pushes HEAD to https://github.com/Kanpary/XaxinoTest
#
# Usage:
#   bash scripts/github-sync.sh
#
# Requirements:
#   GITHUB_TOKEN env var must be set (Replit Secrets panel).
#   Run scripts/setup-github-sync.sh once to install the post-commit hook.
set -euo pipefail

CLEAN_REMOTE="https://github.com/Kanpary/XaxinoTest.git"
BRANCH="main"

# ── Token ────────────────────────────────────────────────────────────────────
if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "Error: GITHUB_TOKEN env var is not set." >&2
  echo "  Add it in the Replit Secrets panel, then retry." >&2
  exit 1
fi

# ── Repository root ───────────────────────────────────────────────────────────
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# ── Remove stale lock file (safe: lock is only held during an active write) ───
LOCK="$REPO_ROOT/.git/config.lock"
if [ -f "$LOCK" ]; then
  echo "Removing stale .git/config.lock..."
  rm -f "$LOCK"
fi

# ── Ensure origin points to the clean (token-free) URL ───────────────────────
if git remote get-url origin 2>/dev/null | grep -q "github.com"; then
  git remote set-url origin "$CLEAN_REMOTE"
else
  git remote remove origin 2>/dev/null || true
  git remote add origin "$CLEAN_REMOTE"
fi

# ── Push via inline credential helper (token never written to .git/config) ───
# -u sets upstream tracking to origin/main (not to a hardcoded URL).
echo "Pushing $BRANCH → $CLEAN_REMOTE ..."
GIT_TOKEN="$GITHUB_TOKEN" git \
  -c "credential.helper=!f() { echo username=x-access-token; echo \"password=\$GIT_TOKEN\"; }; f" \
  push -u origin "$BRANCH" 2>&1

echo "GitHub sync complete."
