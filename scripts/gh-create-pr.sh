#!/usr/bin/env bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh CLI is not installed. Install from https://cli.github.com/" >&2
  exit 1
fi

TITLE="${1:-}"
if [[ -z "$TITLE" ]]; then
  read -r -p "PR title: " TITLE
fi

if [[ -z "$TITLE" ]]; then
  echo "Error: PR title is required." >&2
  exit 1
fi

BODY="${2:-$(cat <<'EOF'
## Summary
- 

## Test plan
- [ ] 
EOF
)}"

CURRENT_BRANCH="$(git branch --show-current)"
if [[ "$CURRENT_BRANCH" == "main" || "$CURRENT_BRANCH" == "master" ]]; then
  echo "Error: create a feature branch before opening a PR." >&2
  exit 1
fi

git push -u origin HEAD
gh pr create --base main --title "$TITLE" --body "$BODY"
