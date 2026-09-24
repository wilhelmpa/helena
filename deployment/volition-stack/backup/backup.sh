#!/usr/bin/env bash
set -euo pipefail
umask 077
export GOMEMLIMIT=512MiB GOMAXPROCS=2
base=/home/pw/services/volition-backups
export RESTIC_REPOSITORY="$base/restic"
export RESTIC_PASSWORD_FILE=/home/pw/services/volition-stack/.secrets/backup_restic_password
export RESTIC_CACHE_DIR="$base/cache"
stage="$base/current"
mkdir -p "$stage"
exec 9>"$base/backup.lock"
flock -n 9 || exit 0
paused_containers=()
cleanup_services() {
  local container
  for container in "${paused_containers[@]}"; do docker unpause "$container" >/dev/null 2>&1 || true; done
  docker exec --user www-data volition-apps-nextcloud-1 php occ maintenance:mode --off >/dev/null 2>&1 || true
}
cleanup() {
  cleanup_services
  rm -f \
    "$stage/plan-residual-volumes.tar.new" "$stage/plan-residual-volumes.tar"
}
pause_containers() {
  local container
  for container in "$@"; do docker pause "$container" >/dev/null; paused_containers+=("$container"); done
}
unpause_containers() {
  local container
  for container in "${paused_containers[@]}"; do docker unpause "$container" >/dev/null; done
  paused_containers=()
}
trap cleanup EXIT
docker exec --user www-data volition-apps-nextcloud-1 php occ maintenance:mode --on >/dev/null
# Keep each database dump consistent with its corresponding mutable file store.
# The writers remain paused only for their own dump and small storage archive.
pause_containers itsaplan-api-1 itsaplan-worker-1 itsaplan-garage-1
docker exec itsaplan-postgres-1 pg_dump -U itsaplan -d itsaplan --format=custom > "$stage/itsaplan.dump.new"
plan_counts=$(docker exec itsaplan-postgres-1 psql -U itsaplan -d itsaplan -At -F, -c 'select (select count(*) from project),(select count(*) from issue),(select count(*) from ai_agent),(select count(*) from agent_run),(select count(*) from team);')
docker run --rm --network none --read-only --security-opt no-new-privileges:true \
  --pids-limit 32 --memory 256m --cpus 1 --entrypoint /bin/sh \
  -v /home/pw/services/volition-stack/garage/meta:/data/garage-meta:ro \
  -v /home/pw/services/volition-stack/garage/data:/data/garage-data:ro \
  -v "$stage:/backup" postgres:17-alpine \
  -c 'umask 077; tar -C /data -cf /backup/garage-volumes.tar.new ./garage-meta ./garage-data; chown 1000:1000 /backup/garage-volumes.tar.new'
docker run --rm --network none --read-only --security-opt no-new-privileges:true \
  --pids-limit 32 --memory 256m --cpus 1 --entrypoint /bin/sh \
  -v itsaplan_db-backups:/data/itsaplan-db-backups:ro \
  -v itsaplan_minio-data:/data/itsaplan-minio-data:ro \
  -v "$stage:/backup" postgres:17-alpine \
  -c 'umask 077; tar -C /data -cf /backup/plan-residual-volumes.tar.new ./itsaplan-db-backups ./itsaplan-minio-data; chown 1000:1000 /backup/plan-residual-volumes.tar.new'
unpause_containers
# Vaultwarden uses SQLite WAL: capture database, WAL and encrypted attachments
# together with the writer paused. The live directory is excluded from restic.
pause_containers volition-vault-vaultwarden-1
tar -C /home/pw/services/volition-stack/.state -cf "$stage/vaultwarden-volumes.tar.new" vaultwarden
python3 /home/pw/services/volition-stack/backup/tests/vault-manifest.py \
  --database /home/pw/services/volition-stack/.state/vaultwarden/db.sqlite3 \
  --archive "$stage/vaultwarden-volumes.tar.new" \
  --output "$stage/vaultwarden-manifest.json.new"
unpause_containers
docker exec volition-apps-nextcloud-db-1 pg_dump -U nextcloud -d nextcloud --format=custom > "$stage/nextcloud.dump.new"
nextcloud_counts=$(docker exec volition-apps-nextcloud-db-1 psql -U nextcloud -d nextcloud -At -F, -c 'select (select count(*) from oc_filecache),(select count(*) from oc_users),(select count(*) from oc_share);')
# Capture counts while each application's writers are quiescent. Restore tests
# compare with this snapshot's manifest, never with a changing live database.
python3 - "$stage/database-counts.json.new" "$plan_counts" "$nextcloud_counts" <<'PY'
import json,re,sys
keys=('plan','nextcloud')
patterns=(r'\d+(?:,\d+){4}',r'\d+(?:,\d+){2}')
values=sys.argv[2:]
for key,pattern,value in zip(keys,patterns,values):
    if re.fullmatch(pattern,value) is None:
        raise SystemExit(f'Invalid quiescent database count: {key}')
with open(sys.argv[1],'w',encoding='utf-8') as handle:
    json.dump(dict(zip(keys,values)),handle,indent=2)
    handle.write('\n')
PY
volume_mounts=(
  -v volition-apps_nextcloud_html:/data/nextcloud-html:ro
  -v volition-apps_nextcloud_data:/data/nextcloud-data:ro
  -v volition-apps_workspace_home:/data/editor-home:ro
)
archive_paths=(
  ./nextcloud-html
  ./nextcloud-data
  ./editor-home
)
add_host_path() {
  local source=$1 target=$2
  if [[ -e "$source" ]]; then
    volume_mounts+=(-v "$source:/data/host-config/$target:ro")
    archive_paths+=("./host-config/$target")
  fi
}
add_host_path /etc/ssh etc/ssh
add_host_path /etc/ufw etc/ufw
add_host_path /etc/default/ufw etc/default/ufw
add_host_path /etc/cloudflared etc/cloudflared
add_host_path /etc/docker etc/docker
add_host_path /etc/systemd/system/cloudflared.service etc/systemd/system/cloudflared.service
add_host_path /etc/systemd/system/cloudflared.service.d etc/systemd/system/cloudflared.service.d
add_host_path /usr/lib/systemd/system/cloudflared.service usr/lib/systemd/system/cloudflared.service
add_host_path /usr/lib/systemd/system/cloudflared.service.d usr/lib/systemd/system/cloudflared.service.d
add_host_path /lib/systemd/system/cloudflared.service lib/systemd/system/cloudflared.service
add_host_path /lib/systemd/system/cloudflared.service.d lib/systemd/system/cloudflared.service.d
add_host_path /home/pw/services/volition-ops/cutover-cloudflare-ssh.sh home/pw/services/volition-ops/cutover-cloudflare-ssh.sh
# Each read-only mount is an explicit application data volume, never a Docker socket.
# The editor home now contains live CLI authentication/state databases. Capture
# them together while their writer is paused; the EXIT trap also unpauses it.
pause_containers volition-apps-workspace-1
docker run --rm --network none --read-only --security-opt no-new-privileges:true \
  --pids-limit 32 --memory 256m --cpus 1 --entrypoint /bin/sh \
  "${volume_mounts[@]}" \
  -v "$stage:/backup" postgres:17-alpine \
  -c 'umask 077; tar -C /data -cf /backup/application-volumes.tar.new "$@"; chown 1000:1000 /backup/application-volumes.tar.new' \
  archive "${archive_paths[@]}"
unpause_containers
docker exec -i -w /app/apps/api itsaplan-api-1 bun - \
  < /home/pw/services/volition-stack/backup/tests/garage-manifest.mjs \
  > "$stage/garage-manifest.json.new"
for name in itsaplan.dump nextcloud.dump database-counts.json garage-volumes.tar plan-residual-volumes.tar application-volumes.tar garage-manifest.json vaultwarden-volumes.tar vaultwarden-manifest.json; do mv "$stage/$name.new" "$stage/$name"; done
cleanup_services
trap - EXIT
sensitive_archive="$stage/plan-residual-volumes.tar"
restore_probe=
cleanup_encrypted_phase() {
  rm -f "$sensitive_archive" "$sensitive_archive.new"
  if [[ -n "$restore_probe" ]]; then rm -rf "$restore_probe"; fi
}
trap cleanup_encrypted_phase EXIT
restic snapshots --json >/dev/null 2>&1 || restic init >/dev/null
# User-owned runtime entry points referenced by restored units must be restorable.
# Explicit paths avoid collecting unrelated applications from the user's home.
runtime_paths=()
for runtime_path in \
  /home/pw/services/volition-ops \
  /home/pw/.local/lib/hermes-ui-hardening.mjs \
  /home/pw/.local/lib/hermes-browser-quality.mjs \
  /home/pw/.local/lib/volition-theme-bridge-v1.js \
  /home/pw/.local/bin/gog-hermes-read \
  /home/pw/.local/bin/gog-hermes-write \
  /home/pw/.local/bin/volition; do
  if [[ -e "$runtime_path" ]]; then runtime_paths+=("$runtime_path"); fi
done
backup_result=$(restic backup --read-concurrency 1 --quiet --json --tag volition --exclude-file /home/pw/services/volition-stack/backup/excludes.txt \
  "$stage" /home/pw/services/itsaplan /home/pw/services/volition-stack \
  /home/pw/services/volition-workspaces \
  /home/pw/services/volition-stack/data/hermes /home/pw/.config/systemd/user /home/pw/.config/itsaplan \
  /home/pw/.local/share/hermes-gog /home/pw/Projekte/Shopify/v1-cart-suite "${runtime_paths[@]}")
snapshot_id=$(python3 -c '
import json,re,sys
rows=[json.loads(line) for line in sys.stdin if line.strip()]
summaries=[row for row in rows if row.get("message_type") == "summary"]
if len(summaries) != 1 or re.fullmatch(r"[a-f0-9]{64}", summaries[0].get("snapshot_id", "")) is None:
    raise SystemExit("Could not identify the new encrypted backup snapshot")
print(summaries[0]["snapshot_id"])
' <<<"$backup_result")
unset backup_result
restic forget --quiet --tag volition --keep-daily 7 --keep-weekly 5 --keep-monthly 12
restic check --quiet
restore_probe=$(mktemp -d "$base/.restore-probe.XXXXXX")
chmod 700 "$restore_probe"
restic restore "$snapshot_id" --target "$restore_probe" \
  --include /home/pw/services/volition-backups/current/database-counts.json \
  --include /home/pw/services/volition-backups/current/plan-residual-volumes.tar >/dev/null
python3 - "$restore_probe/home/pw/services/volition-backups/current/database-counts.json" <<'PY'
import json,re,sys
data=json.load(open(sys.argv[1],encoding='utf-8'))
if re.fullmatch(r'\d+(?:,\d+){4}',data.get('plan','')) is None:
    raise SystemExit('Restored Plan database-count manifest is invalid')
if re.fullmatch(r'\d+(?:,\d+){2}',data.get('nextcloud','')) is None:
    raise SystemExit('Restored Nextcloud database-count manifest is invalid')
PY
restored_residual="$restore_probe/home/pw/services/volition-backups/current/plan-residual-volumes.tar"
tar -tf "$restored_residual" > "$restore_probe/residual-volume-files.txt"
grep -Eq '^\./itsaplan-db-backups(/|$)' "$restore_probe/residual-volume-files.txt"
grep -Eq '^\./itsaplan-minio-data(/|$)' "$restore_probe/residual-volume-files.txt"
rm -rf "$restore_probe"
restore_probe=
staging_allowlist=(
  itsaplan.dump nextcloud.dump database-counts.json garage-volumes.tar
  plan-residual-volumes.tar application-volumes.tar garage-manifest.json
  vaultwarden-volumes.tar vaultwarden-manifest.json
)
for name in "${staging_allowlist[@]}"; do rm -f "$stage/$name" "$stage/$name.new"; done
chmod 700 "$stage"
if find "$stage" -mindepth 1 -print -quit | grep -q .; then
  echo 'Plaintext backup staging contains a non-allowlisted entry' >&2
  exit 1
fi
if [[ $(stat -c '%u:%a' "$stage") != "$(id -u):700" ]]; then
  echo 'Plaintext backup staging ownership or mode is unsafe' >&2
  exit 1
fi
completed_at=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
rm -f "$base/last-success.new"
python3 - "$base/last-success.new" "$completed_at" "$snapshot_id" <<'PY'
import json,re,sys
target,completed_at,snapshot_id=sys.argv[1:]
if re.fullmatch(r'[a-f0-9]{64}', snapshot_id) is None:
    raise SystemExit('Invalid encrypted backup snapshot id')
with open(target,'x',encoding='utf-8') as handle:
    json.dump({'schemaVersion':1,'completedAt':completed_at,'snapshotId':snapshot_id,'restoreProbeVerified':True,'plaintextStagingEmpty':True},handle,indent=2)
    handle.write('\n')
PY
chmod 600 "$base/last-success.new"
mv "$base/last-success.new" "$base/last-success"
trap - EXIT
echo 'Volition encrypted backup and repository verification completed.'
