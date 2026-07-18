#!/usr/bin/env bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh CLI is not installed. Install from https://cli.github.com/" >&2
  exit 1
fi

TITLE="${1:-}"
LABEL="${2:-enhancement}"

if [[ -z "$TITLE" ]]; then
  read -r -p "Issue title: " TITLE
fi

if [[ -z "$TITLE" ]]; then
  echo "Error: issue title is required." >&2
  exit 1
fi

read -r -p "Label [bug|enhancement|documentation|question] (default: $LABEL): " INPUT_LABEL
LABEL="${INPUT_LABEL:-$LABEL}"

BODY="$(cat <<'EOF'
## Description


## Acceptance criteria
- [ ] 
EOF
)"

TMP_FILE="$(mktemp)"
printf '%s\n' "$BODY" > "$TMP_FILE"
${EDITOR:-nano} "$TMP_FILE"

gh issue create --title "$TITLE" --body-file "$TMP_FILE" --label "$LABEL"
rm -f "$TMP_FILE"
