#!/usr/bin/env bash
set -euo pipefail
umask 077
export RESTIC_REPOSITORY=/home/pw/services/volition-backups/restic
export RESTIC_PASSWORD_FILE=/home/pw/services/volition-stack/.secrets/backup_restic_password
export RESTIC_CACHE_DIR=/home/pw/services/volition-backups/cache
export GOMEMLIMIT=512MiB GOMAXPROCS=2
snapshot=${1:-latest}
stage=$(mktemp -d /home/pw/services/volition-backups/database-restore-check.XXXXXX)
containers=(volition-db-restore-plan volition-db-restore-nextcloud)
cleanup() {
  docker rm -f "${containers[@]}" >/dev/null 2>&1 || true
  python3 - "$stage" <<'PY'
from pathlib import Path
import shutil,sys
p=Path(sys.argv[1])
if p.exists(): shutil.rmtree(p)
PY
}
trap cleanup EXIT

for dump in itsaplan nextcloud; do
  restic dump "$snapshot" "/home/pw/services/volition-backups/current/$dump.dump" > "$stage/$dump.dump"
  test -s "$stage/$dump.dump"
done
if ! restic dump "$snapshot" "/home/pw/services/volition-backups/current/database-counts.json" > "$stage/database-counts.json"; then
  echo "Snapshot does not contain database-counts.json; it cannot receive the current exact-count restore verification." >&2
  exit 1
fi
python3 - "$stage/database-counts.json" > "$stage/expected-counts" <<'PY'
import json,re,sys
path=sys.argv[1]
with open(path,encoding='utf-8') as handle:
    value=json.load(handle)
if not isinstance(value,dict) or set(value) != {'plan','nextcloud'}:
    raise SystemExit('database-counts.json must contain exactly plan and nextcloud')
patterns={'plan':r'\d+(?:,\d+){4}','nextcloud':r'\d+(?:,\d+){2}'}
for key in ('plan','nextcloud'):
    item=value[key]
    if not isinstance(item,str) or re.fullmatch(patterns[key],item) is None:
        raise SystemExit(f'database-counts.json has an invalid {key} count')
    print(item)
PY
mapfile -t expected_counts < "$stage/expected-counts"
test "${#expected_counts[@]}" -eq 2

start_db() {
  local name=$1 image=$2 uid=$3 data_path=$4
  docker run -d --name "$name" --network none --read-only --user "$uid:$uid" \
    --tmpfs "$data_path:rw,nosuid,nodev,size=1g,uid=$uid,gid=$uid" \
    --tmpfs "/run/postgresql:rw,nosuid,nodev,size=16m,uid=$uid,gid=$uid" \
    --tmpfs "/tmp:rw,nosuid,nodev,noexec,size=64m,uid=$uid,gid=$uid" \
    --cap-drop ALL --security-opt no-new-privileges:true \
    --pids-limit 256 --memory 1536m --cpus 2 \
    -e POSTGRES_PASSWORD=restore-only -e POSTGRES_USER=postgres \
    "$image" >/dev/null
  for _ in {1..60}; do
    if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; then return; fi
    sleep 1
  done
  echo "Restore database did not become ready: $name" >&2
  docker logs "$name" 2>&1 | tail -n 40 >&2
  exit 1
}

start_db "${containers[0]}" volition/postgres:17-alpine-gosu-go1.26.6-20260921 70 /var/lib/postgresql/data
start_db "${containers[1]}" volition/postgres:17-alpine-gosu-go1.26.6-20260921 70 /var/lib/postgresql/data
docker exec "${containers[0]}" createdb -U postgres --locale-provider=libc --locale=en_US.utf8 restorecheck
docker exec "${containers[1]}" createdb -U postgres --template=template0 --locale-provider=icu --icu-locale=en-US --locale=en_US.utf8 restorecheck

docker exec -i "${containers[0]}" pg_restore -U postgres -d restorecheck --no-owner --no-privileges --exit-on-error < "$stage/itsaplan.dump"
docker exec -i "${containers[1]}" pg_restore -U postgres -d restorecheck --no-owner --no-privileges --exit-on-error < "$stage/nextcloud.dump"

query_counts() {
  local container=$1 database=$2 sql=$3
  docker exec "$container" psql -U "$database" -d "$database" -At -F, -c "$sql"
}
query_restored() {
  local container=$1 sql=$2
  docker exec "$container" psql -U postgres -d restorecheck -At -F, -c "$sql"
}
query_locale() {
  local container=$1
  docker exec "$container" psql -U postgres -d restorecheck -At -F, \
    -c 'select datlocprovider,datlocale,datcollate,datctype from pg_database where datname=current_database();'
}
plan_sql='select (select count(*) from project),(select count(*) from issue),(select count(*) from ai_agent),(select count(*) from agent_run),(select count(*) from team);'
nextcloud_sql='select (select count(*) from oc_filecache),(select count(*) from oc_users),(select count(*) from oc_share);'
plan_live=$(query_counts itsaplan-postgres-1 itsaplan "$plan_sql")
nextcloud_live=$(query_counts volition-apps-nextcloud-db-1 nextcloud "$nextcloud_sql")
plan_restored=$(query_restored "${containers[0]}" "$plan_sql")
nextcloud_restored=$(query_restored "${containers[1]}" "$nextcloud_sql")
plan_locale=$(query_locale "${containers[0]}")
nextcloud_locale=$(query_locale "${containers[1]}")
[[ "$plan_restored" =~ ^[0-9]+,[0-9]+,[0-9]+,[0-9]+,[0-9]+$ ]]
[[ "$nextcloud_restored" =~ ^[0-9]+,[0-9]+,[0-9]+$ ]]
[[ "$plan_locale" == 'c,,en_US.utf8,en_US.utf8' ]]
[[ "$nextcloud_locale" == 'i,en-US,en_US.utf8,en_US.utf8' ]]
[[ "$plan_restored" == "${expected_counts[0]}" ]]
[[ "$nextcloud_restored" == "${expected_counts[1]}" ]]
printf 'snapshot manifest plan project,issue,agent,run,team=%s\n' "${expected_counts[0]}"
printf 'snapshot plan project,issue,agent,run,team=%s\n' "$plan_restored"
printf 'live plan project,issue,agent,run,team=%s\n' "$plan_live"
printf 'snapshot manifest nextcloud filecache,user,share=%s\n' "${expected_counts[1]}"
printf 'snapshot nextcloud filecache,user,share=%s\n' "$nextcloud_restored"
printf 'live nextcloud filecache,user,share=%s\n' "$nextcloud_live"
printf 'restore locale plan=%s nextcloud=%s\n' "$plan_locale" "$nextcloud_locale"
printf 'Both isolated database dumps restored and their selected tables were queryable.\n'
