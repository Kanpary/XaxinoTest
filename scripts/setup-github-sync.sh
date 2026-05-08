#!/bin/bash
# One-time setup: installs the post-commit hook that auto-syncs to GitHub.
#
# Usage:
#   bash scripts/setup-github-sync.sh
#
# After running this, every `git commit` will push HEAD to GitHub automatically.
# GITHUB_TOKEN must be set in your environment (Replit Secrets panel).
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOK_FILE="$REPO_ROOT/.git/hooks/post-commit"
CLEAN_REMOTE="https://github.com/Kanpary/XaxinoTest.git"

# ── Ensure origin points to the clean (token-free) URL ───────────────────────
if git remote get-url origin 2>/dev/null | grep -q "github.com"; then
  git remote set-url origin "$CLEAN_REMOTE"
  echo "Updated origin → $CLEAN_REMOTE"
else
  git remote remove origin 2>/dev/null || true
  git remote add origin "$CLEAN_REMOTE"
  echo "Added origin → $CLEAN_REMOTE"
fi

# ── Initial push — sets upstream tracking to origin/main ─────────────────────
if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo ""
  echo "Warning: GITHUB_TOKEN is not set — skipping initial push."
  echo "  Add GITHUB_TOKEN in the Replit Secrets panel, then run:"
  echo "  bash scripts/github-sync.sh"
else
  echo "Running initial push with -u to set upstream tracking..."
  GIT_TOKEN="$GITHUB_TOKEN" git \
    -c "credential.helper=!f() { echo username=x-access-token; echo \"password=\$GIT_TOKEN\"; }; f" \
    push -u origin main 2>&1 \
    && echo "Initial push done." || echo "Push failed — check GITHUB_TOKEN."
fi

# ── Install post-commit hook ──────────────────────────────────────────────────
cat > "$HOOK_FILE" << 'HOOK'
#!/bin/bash
# Auto-sync to GitHub after every commit.
# Runs silently; failures do not abort the commit.
REPO_ROOT="$(git rev-parse --show-toplevel)"
bash "$REPO_ROOT/scripts/github-sync.sh" >> "$REPO_ROOT/.git/github-sync.log" 2>&1 || true
HOOK

chmod +x "$HOOK_FILE"
echo "Post-commit hook installed at $HOOK_FILE"
echo ""
echo "Setup complete. Every commit will now auto-push to $CLEAN_REMOTE"
echo "(requires GITHUB_TOKEN in env at commit time)."
