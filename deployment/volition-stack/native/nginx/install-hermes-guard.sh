#!/usr/bin/env bash
set -euo pipefail
umask 077

config="${1:-/etc/nginx/sites-available/volition.conf}"
nginx_bin="${NGINX_BIN:-/usr/sbin/nginx}"
systemctl_bin="${SYSTEMCTL_BIN:-/usr/bin/systemctl}"
nginx_service="${NGINX_SERVICE:-nginx.service}"

if (($# > 1)); then
  echo "Usage: sudo deployment/volition-stack/native/nginx/install-hermes-guard.sh [nginx-site-config]" >&2
  exit 2
fi

for command in python3 "$nginx_bin" "$systemctl_bin"; do
  if [[ ! -x "$(command -v "$command" 2>/dev/null || true)" ]]; then
    echo "Required command is unavailable: $command" >&2
    exit 1
  fi
done
if [[ ! -f "$config" ]]; then
  echo "Nginx site configuration is missing: $config" >&2
  exit 1
fi

set +e
backup="$(python3 - "$config" <<'PY'
from pathlib import Path
from shutil import copy2, copymode
import os
import sys
import tempfile

path = Path(sys.argv[1])
source = path.read_text()
old = """    location /hermes/ {
        auth_request /_plan_auth;
        include /etc/nginx/snippets/volition-tool-proxy-security.conf;
        proxy_pass http://127.0.0.1:9119/;
"""
new = """    location /hermes/ {
        if ($volition_origin_ok = 0) { return 403; }
        auth_request /_plan_auth;
        include /etc/nginx/snippets/volition-tool-proxy-security.conf;
        proxy_hide_header Content-Security-Policy;
        proxy_hide_header X-Frame-Options;
        add_header Content-Security-Policy "frame-ancestors 'self'" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        proxy_pass http://127.0.0.1:9119/;
"""

if source.count(new) == 1 and source.count(old) == 0:
    raise SystemExit(10)
if "map $http_origin $volition_origin_ok {" not in source:
    raise SystemExit("Refusing an Nginx target without the expected Origin allowlist")
if source.count(old) != 1:
    raise SystemExit(
        f"Refusing unexpected Hermes proxy structure: expected one unprotected block, found {source.count(old)}"
    )

descriptor, backup_name = tempfile.mkstemp(
    prefix=f".{path.name}.hermes-guard.", dir=path.parent
)
os.close(descriptor)
backup = Path(backup_name)
copy2(path, backup)

descriptor, staged_name = tempfile.mkstemp(prefix=f".{path.name}.staged.", dir=path.parent)
with os.fdopen(descriptor, "w") as staged:
    staged.write(source.replace(old, new, 1))
    staged.flush()
    os.fsync(staged.fileno())
staged = Path(staged_name)
copymode(path, staged)
os.replace(staged, path)
print(backup)
PY
)"
patch_status=$?
set -e

if ((patch_status == 10)); then
  echo "Hermes Nginx Origin and frame guard is already installed."
  exit 0
fi
if ((patch_status != 0)); then
  exit "$patch_status"
fi

restore() {
  cp --preserve=mode,timestamps -- "$backup" "$config"
}

if ! "$nginx_bin" -t; then
  restore
  echo "Nginx validation failed; the previous configuration was restored." >&2
  exit 1
fi

if ! "$systemctl_bin" reload "$nginx_service"; then
  restore
  if "$nginx_bin" -t; then
    "$systemctl_bin" reload "$nginx_service" || true
  fi
  echo "Nginx reload failed; the previous configuration was restored." >&2
  exit 1
fi

rm -- "$backup"
echo "Hermes Nginx Origin and frame guard installed."
