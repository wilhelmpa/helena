#!/usr/bin/env bash
# Replace the dev database with a fresh copy of the live one. Every copied object is
# owned by the application role, so the dev API connects with the live credentials.
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "refresh-db.sh: run with sudo" >&2; exit 1; }

live=${LIVE_DB:-itsaplan}
dev=${DEV_DB:-itsaplan_dev}
role=${DB_ROLE:-itsaplan}
[[ $dev != "$live" ]] || { echo "refresh-db.sh: dev and live database are the same" >&2; exit 1; }

as_postgres() { runuser -u postgres -- "$@"; }

as_postgres dropdb --if-exists --force "$dev"
as_postgres createdb -O "$role" "$dev"
# Extensions need a superuser; everything else is created as the application role.
for extension in $(as_postgres psql -At "$live" -c "select extname from pg_extension where extname <> 'plpgsql'"); do
  as_postgres psql -q "$dev" -c "create extension if not exists \"$extension\""
done
{
  echo "set role $role;"
  as_postgres pg_dump --no-owner --no-privileges "$live" | grep -Ev '^(CREATE|COMMENT ON) EXTENSION'
} | as_postgres psql -q -v ON_ERROR_STOP=1 "$dev" >/dev/null
echo "dev database $dev refreshed from $live"
