#!/usr/bin/env bash
set -euo pipefail
umask 077
export RESTIC_REPOSITORY=/home/pw/services/volition-backups/restic
export RESTIC_PASSWORD_FILE=/home/pw/services/volition-stack/.secrets/backup_restic_password
export RESTIC_CACHE_DIR=/home/pw/services/volition-backups/cache
export GOMEMLIMIT=512MiB GOMAXPROCS=2
snapshot=${1:-latest}
check=volition-garage-restore-check
network=volition-garage-restore-check
stage=$(mktemp -d /home/pw/services/volition-backups/garage-restore-check.XXXXXX)
cleanup() {
  docker rm -f "$check" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  python3 - "$stage" <<'PY'
from pathlib import Path
import shutil,sys
p=Path(sys.argv[1])
if p.exists(): shutil.rmtree(p)
PY
}
trap cleanup EXIT
mkdir -p "$stage/volumes" "$stage/config"
restic dump "$snapshot" /home/pw/services/volition-backups/current/garage-volumes.tar \
  | tar -C "$stage/volumes" -xf - ./garage-meta ./garage-data
restic dump "$snapshot" /home/pw/services/volition-backups/current/garage-manifest.json > "$stage/expected.json"
restic restore "$snapshot" --quiet --target "$stage/config" \
  --include /home/pw/services/volition-stack/garage/garage.toml \
  --include /home/pw/services/itsaplan/.env
config="$stage/config/home/pw/services/volition-stack/garage/garage.toml"
app_env="$stage/config/home/pw/services/itsaplan/.env"
python3 - "$app_env" "$stage/client.env" "$stage/server.env" <<'PY'
from pathlib import Path
import os,sys
values={}
for line in Path(sys.argv[1]).read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        key,value=line.split('=',1); values[key]=value
required=('GARAGE_ACCESS_KEY_ID','GARAGE_SECRET_ACCESS_KEY')
if not all(values.get(key) for key in required): raise SystemExit('Garage credentials missing from restore')
Path(sys.argv[2]).write_text(
    f"S3_ENDPOINT=http://garage:3900\nS3_BUCKET=planner-attachments\nS3_REGION=garage\n"
    f"S3_FORCE_PATH_STYLE=true\nS3_ACCESS_KEY_ID={values['GARAGE_ACCESS_KEY_ID']}\n"
    f"S3_SECRET_ACCESS_KEY={values['GARAGE_SECRET_ACCESS_KEY']}\n"
)
os.chmod(sys.argv[2],0o600)
Path(sys.argv[3]).write_text(
    f"GARAGE_DEFAULT_ACCESS_KEY={values['GARAGE_ACCESS_KEY_ID']}\n"
    f"GARAGE_DEFAULT_SECRET_KEY={values['GARAGE_SECRET_ACCESS_KEY']}\n"
    "GARAGE_DEFAULT_BUCKET=planner-attachments\n"
)
os.chmod(sys.argv[3],0o600)
PY
docker network create --internal "$network" >/dev/null
docker run -d --name "$check" --network "$network" --network-alias garage \
  --env-file "$stage/server.env" \
  --user 1000:1000 --read-only --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m \
  --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 128 --memory 512m --cpus 1 \
  -v "$config:/etc/garage.toml:ro" \
  -v "$stage/volumes/garage-meta:/meta" -v "$stage/volumes/garage-data:/data" \
  dxflrs/garage@sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020 \
  /garage server --single-node --default-bucket >/dev/null
ready=false
for _ in {1..60}; do
  if docker logs "$check" 2>&1 | grep -q 'S3 API server listening'; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  docker logs "$check" 2>&1 | tail -n 40 >&2
  exit 1
fi
docker exec --user 1000:1000 "$check" /garage bucket info planner-attachments >/dev/null
garage_ip=$(docker inspect "$check" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
python3 - "$stage/client.env" "$garage_ip" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
lines=[line for line in p.read_text().splitlines() if not line.startswith('S3_ENDPOINT=')]
p.write_text('\n'.join(lines)+f'\nS3_ENDPOINT=http://{sys.argv[2]}:3900\n')
PY
docker run --rm --network "$network" --env-file "$stage/client.env" --entrypoint bun \
  -v /home/pw/services/volition-stack/backup/tests/garage-manifest.mjs:/app/apps/api/garage-manifest.mjs:ro \
  volition/itsaplan-api:2026-09-21-v13 /app/apps/api/garage-manifest.mjs > "$stage/actual.json"
cmp "$stage/expected.json" "$stage/actual.json"
python3 - "$stage/actual.json" <<'PY'
import json,sys
data=json.load(open(sys.argv[1]))
print(f"Encrypted Garage restore verified: {data['count']} objects, {data['totalBytes']} bytes, exact manifest SHA-256 match.")
PY
