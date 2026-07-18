#!/usr/bin/env bash
set -uo pipefail

input=$(cat)
command=$(echo "$input" | jq -r '.command // empty')

if [[ ! "$command" =~ ^git[[:space:]]+commit ]]; then
  echo '{ "permission": "allow" }'
  exit 0
fi

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_ROOT"

run_pm() {
  if command -v bun >/dev/null 2>&1 && [[ -f "$PROJECT_ROOT/bun.lock" ]]; then
    bun run "$@"
  elif command -v pnpm >/dev/null 2>&1 && [[ -f "$PROJECT_ROOT/pnpm-lock.yaml" ]]; then
    pnpm run "$@"
  else
    npm run "$@"
  fi
}

deny() {
  local message=$1
  local escaped
  escaped=$(printf '%s' "$message" | jq -Rs .)
  cat <<EOF
{
  "permission": "deny",
  "user_message": "Commit blocked: TypeScript or build checks failed. Fix errors before committing.",
  "agent_message": ${escaped}
}
EOF
  exit 2
}

log=""
failed=0

if ! output=$(run_pm typecheck 2>&1); then
  log+="TypeScript check failed:\n${output}\n\n"
  failed=1
else
  log+="TypeScript check passed.\n"
fi

if ! output=$(run_pm build 2>&1); then
  log+="Build failed:\n${output}\n"
  failed=1
else
  log+="Build passed.\n"
fi

if [[ "$failed" -eq 1 ]]; then
  deny "$log"
fi

echo '{ "permission": "allow", "agent_message": "Pre-commit checks passed (typecheck + build)." }'
exit 0
