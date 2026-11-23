#!/usr/bin/env bash
# WAL-1078: RLS on site_content.staff.nav — only admins may write the sidebar layout.
#
# Cross-tenant: each BananaFORCE client is a separate Supabase project (its own
# database). staff.nav in client A is never visible in client B; this script
# asserts that isolation using two databases on one throwaway Postgres instance.
#
# Requires: docker, bash 4+.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATION="${REPO_ROOT}/supabase/migrations/0096_staff_nav_admin_only.sql"
CONTAINER=""
PORT=""

cleanup() {
  if [[ -n "${CONTAINER}" ]]; then
    docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

psql_as_run() {
  local role_app="$1"
  local db="$2"
  local sql="$3"
  docker exec -i "${CONTAINER}" psql -v ON_ERROR_STOP=1 -U postgres -d "${db}" <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role_app', '${role_app}', true);
${sql}
COMMIT;
SQL
}

expect_fail() {
  local role_app="$1"
  local db="$2"
  local sql="$3"
  if docker exec -i "${CONTAINER}" psql -v ON_ERROR_STOP=1 -U postgres -d "${db}" <<SQL 2>/dev/null
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role_app', '${role_app}', true);
${sql}
COMMIT;
SQL
  then
    fail "expected RLS denial for role_app=${role_app}: ${sql//$'\n'/ }"
  fi
}

setup_db() {
  local db="$1"
  docker exec -i "${CONTAINER}" psql -v ON_ERROR_STOP=1 -U postgres <<SQL
CREATE DATABASE ${db};
SQL
  docker exec -i "${CONTAINER}" psql -v ON_ERROR_STOP=1 -U postgres -d "${db}" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOINHERIT;
  END IF;
END
$$;
GRANT authenticated TO postgres;

CREATE TABLE public.site_content (
  key text PRIMARY KEY,
  value jsonb,
  updated_at timestamptz
);
ALTER TABLE public.site_content ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(current_setting('request.jwt.claim.role_app', true), '') IN ('staff', 'admin');
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT current_setting('request.jwt.claim.role_app', true) = 'admin';
$$;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_content TO authenticated;

CREATE POLICY "admin_staff_all_site_content"
  ON public.site_content
  FOR ALL
  TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());
SQL
  docker exec -i "${CONTAINER}" psql -v ON_ERROR_STOP=1 -U postgres -d "${db}" -f - <"${MIGRATION}"
}

[[ -f "${MIGRATION}" ]] || fail "missing migration ${MIGRATION}"

PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("", 0)); print(s.getsockname()[1]); s.close()')"
CONTAINER="bf-rls-staff-nav-$$"
docker run -d --rm --name "${CONTAINER}" -e POSTGRES_HOST_AUTH_METHOD=trust -p "${PORT}:5432" postgres:16 >/dev/null

for _ in $(seq 1 30); do
  if docker exec "${CONTAINER}" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
docker exec "${CONTAINER}" pg_isready -U postgres >/dev/null 2>&1 || fail "postgres did not become ready"

setup_db client_a
setup_db client_b

# Staff cannot touch staff.nav
expect_fail staff client_a "INSERT INTO public.site_content (key, value) VALUES ('staff.nav', '{\"order\":[],\"labels\":{}}');"
psql_as_run admin client_a "INSERT INTO public.site_content (key, value) VALUES ('staff.nav', '{\"order\":[\"/crm\"],\"labels\":{}}');"
psql_as_run staff client_a "UPDATE public.site_content SET value = '{\"order\":[]}' WHERE key = 'staff.nav';"
STAFF_NAV_A="$(docker exec "${CONTAINER}" psql -t -A -U postgres -d client_a -c "SELECT value::text FROM public.site_content WHERE key = 'staff.nav';")"
[[ "${STAFF_NAV_A}" == *crm* ]] || fail "staff must not update staff.nav (got ${STAFF_NAV_A})"
psql_as_run staff client_a "INSERT INTO public.site_content (key, value) VALUES ('homepage.hero', '{\"title\":\"Hi\"}');"
psql_as_run staff client_a "UPDATE public.site_content SET value = '{\"title\":\"Bye\"}' WHERE key = 'homepage.hero';"
HERO="$(docker exec "${CONTAINER}" psql -t -A -U postgres -d client_a -c "SELECT value::text FROM public.site_content WHERE key = 'homepage.hero';")"
[[ "${HERO}" == *Bye* ]] || fail "staff must be allowed to update non-staff.nav keys"

# Admin can write staff.nav (row already exists from setup above)
psql_as_run admin client_a "UPDATE public.site_content SET value = '{\"order\":[\"/expenses\"],\"labels\":{}}', updated_at = now() WHERE key = 'staff.nav';"

COUNT_A="$(docker exec "${CONTAINER}" psql -t -A -U postgres -d client_a -c "SELECT value::text FROM public.site_content WHERE key = 'staff.nav';")"
[[ "${COUNT_A}" == *expenses* ]] || fail "admin update to staff.nav missing in client_a"

psql_as_run staff client_a "DELETE FROM public.site_content WHERE key = 'staff.nav';"
ROWS_NAV_A="$(docker exec "${CONTAINER}" psql -t -A -U postgres -d client_a -c "SELECT count(*) FROM public.site_content WHERE key = 'staff.nav';")"
[[ "${ROWS_NAV_A}" == "1" ]] || fail "staff must not delete staff.nav"

# Cross-tenant: layout in client_a is not visible in client_b
ROWS_B="$(docker exec "${CONTAINER}" psql -t -A -U postgres -d client_b -c "SELECT count(*) FROM public.site_content WHERE key = 'staff.nav';")"
[[ "${ROWS_B}" == "0" ]] || fail "client_b must not see client_a staff.nav (got count ${ROWS_B})"

psql_as_run admin client_b "INSERT INTO public.site_content (key, value) VALUES ('staff.nav', '{\"order\":[],\"labels\":{\"/crm\":\"Other\"}}');"
VAL_B="$(docker exec "${CONTAINER}" psql -t -A -U postgres -d client_b -c "SELECT value::text FROM public.site_content WHERE key = 'staff.nav';")"
[[ "${VAL_B}" == *Other* ]] || fail "client_b staff.nav not independent"
[[ "${VAL_B}" != *expenses* ]] || fail "client_b staff.nav leaked client_a data"

echo "OK: staff_nav RLS (staff blocked, other keys allowed, admin writes, cross-tenant isolation)"