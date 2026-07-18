#!/usr/bin/env bash
set -uo pipefail

input=$(cat)
command=$(echo "$input" | jq -r '.command // empty')

if [[ -z "$command" ]]; then
  echo '{ "permission": "allow" }'
  exit 0
fi

lower=$(printf '%s' "$command" | tr '[:upper:]' '[:lower:]')

is_db_context=0
if [[ "$lower" =~ (psql|mysql|mariadb|mongosh|mongo[[:space:]]|redis-cli|sqlite3|sqlcmd|pgcli|supabase[[:space:]]+db|prisma[[:space:]]|drizzle-kit|typeorm|knex[[:space:]]|sequelize|db[[:space:]]push|db[[:space:]]migrate|db[[:space:]]seed|migration:run|migrate:(dev|deploy|up)) ]]; then
  is_db_context=1
fi

if [[ "$lower" =~ (insert[[:space:]]+into|update[[:space:]]+[a-z0-9_\"]+[[:space:]]+set|delete[[:space:]]+from|drop[[:space:]]+(table|database|schema|index)|truncate[[:space:]]+table|alter[[:space:]]+table|create[[:space:]]+(table|database|schema|index)|grant[[:space:]]+|revoke[[:space:]]+|merge[[:space:]]+into|replace[[:space:]]+into) ]]; then
  is_db_context=1
fi

if [[ "$is_db_context" -eq 0 ]]; then
  echo '{ "permission": "allow" }'
  exit 0
fi

if [[ "$lower" =~ (select[[:space:]]+|explain[[:space:]]+|describe[[:space:]]+|show[[:space:]]+(tables|databases|schemas)|pg_dump|mysqldump|prisma[[:space:]]+(studio|db[[:space:]]+pull|generate|format|validate)|drizzle-kit[[:space:]]+(check|generate|introspect)|db[[:space:]]+(pull|status|diff)) ]]; then
  if [[ ! "$lower" =~ (insert|update|delete|drop|truncate|alter[[:space:]]+table|create[[:space:]]+(table|database)|push|migrate|seed|migration:run|migrate:(dev|deploy|up)|redis-cli[[:space:]].*(set|del|flush|hset|lpush|sadd|zadd)) ]]; then
    echo '{ "permission": "allow" }'
    exit 0
  fi
fi

jq -n \
  --arg cmd "$command" \
  '{
    permission: "ask",
    user_message: "This command may write to or change the database. Approve only if you intend to modify database data or schema.",
    agent_message: ("Database write guard: user approval is required before running: " + $cmd + ". Prefer mock data, user-reviewed migrations, or read-only queries unless explicitly authorized.")
  }'
exit 0
