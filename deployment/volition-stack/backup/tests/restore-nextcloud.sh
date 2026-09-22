#!/usr/bin/env bash
set -euo pipefail
umask 077
export RESTIC_REPOSITORY=/home/pw/services/volition-backups/restic
export RESTIC_PASSWORD_FILE=/home/pw/services/volition-stack/.secrets/backup_restic_password
export RESTIC_CACHE_DIR=/home/pw/services/volition-backups/cache
export GOMEMLIMIT=512MiB GOMAXPROCS=2
check=volition-nextcloud-restore-check
stage=$(mktemp -d /home/pw/services/volition-backups/restore-check.XXXXXX)
trap 'docker rm -f "$check" >/dev/null 2>&1 || true; rm -f "$stage/nextcloud.dump"; rmdir "$stage"' EXIT
restic check --read-data --quiet
restic dump latest /home/pw/services/volition-backups/current/nextcloud.dump > "$stage/nextcloud.dump"
docker run -d --name "$check" --network none --memory 512m --pids-limit 128 --tmpfs /var/lib/postgresql/data:rw,size=512m -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17.6-bookworm >/dev/null
for i in {1..40}; do if docker exec "$check" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi; sleep .5; done
docker exec "$check" createdb -h 127.0.0.1 -U postgres restorecheck
docker exec -i "$check" pg_restore -h 127.0.0.1 -U postgres -d restorecheck --no-owner --no-privileges --exit-on-error < "$stage/nextcloud.dump"
docker exec "$check" psql -h 127.0.0.1 -U postgres -d restorecheck -c 'SELECT (SELECT count(*) FROM oc_users) AS users, (SELECT count(*) FROM oc_filecache) AS files;'
restic dump latest /home/pw/services/volition-backups/current/application-volumes.tar | python3 /home/pw/services/volition-stack/backup/tests/verify-files.py
