#!/usr/bin/env bash
# Security tests for the database migrations (RLS, grants, WhatsApp queue).
# Needs a disposable local Postgres 15+ reachable through the usual PG* variables
# (PGHOST, PGPORT, PGUSER) with permission to create databases and roles.
# Never point it at Lovable Cloud: it creates roles and test data.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
owner="723bdc1b-0db6-4118-9d97-c8a033df9b9f"
db="pulsepad_db_test_$$"
db_missing_owner="${db}_no_owner"
psql_opts=(-X -q -v ON_ERROR_STOP=1)

cleanup() {
  dropdb --if-exists "$db" >/dev/null 2>&1 || true
  dropdb --if-exists "$db_missing_owner" >/dev/null 2>&1 || true
}
trap cleanup EXIT

migrate() {
  local target="$1"
  for file in "$root"/drizzle/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
    psql "${psql_opts[@]}" --single-transaction -d "$target" -f "$file" >/dev/null
  done
}

stub() {
  # Roles are cluster-wide: create them once and ignore "already exists".
  psql -X -q -d "$1" -f "$root/tests/db/supabase-stub.sql" >/dev/null 2>&1 || true
  psql "${psql_opts[@]}" -d "$1" -c "SELECT 1 FROM auth.users LIMIT 1" >/dev/null
}

echo "1/2 La migración se niega a correr si el propietario confirmado no existe"
createdb "$db_missing_owner"
stub "$db_missing_owner"
if migrate "$db_missing_owner" 2>/tmp/pulsepad-migrate.err; then
  echo "FALLO: la migración 0008 se aplicó sin el propietario en auth.users" >&2
  exit 1
fi
grep -q "no existe en auth.users" /tmp/pulsepad-migrate.err || {
  cat /tmp/pulsepad-migrate.err >&2
  echo "FALLO: la migración falló por otro motivo" >&2
  exit 1
}
untouched="$(psql -X -At -d "$db_missing_owner" -c "SELECT to_regclass('public.account_memberships') IS NULL")"
[ "$untouched" = "t" ] || { echo "FALLO: la migración dejó cambios a medias" >&2; exit 1; }
echo "   ok"

echo "2/2 RLS, permisos y cola de WhatsApp"
createdb "$db"
stub "$db"
psql "${psql_opts[@]}" -d "$db" -c "INSERT INTO auth.users VALUES ('$owner', 'owner@pulsepad.test')"
migrate "$db"
psql "${psql_opts[@]}" -d "$db" -f "$root/tests/db/security.test.sql"
echo "   ok"
